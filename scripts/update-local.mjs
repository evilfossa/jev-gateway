import { spawn } from "node:child_process";
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { installationIdentity } from "../bin/identity.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function run(command, args, cwd, quiet = false) {
  return new Promise((done, reject) => {
    const child = spawn(command, args, { cwd, stdio: quiet ? ["ignore", "ignore", "inherit"] : "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? done() : reject(new Error(`${command} exited with ${code}`)));
  });
}

function npm(args, cwd, runCommand) {
  const cli = process.env.npm_execpath;
  return cli?.endsWith("npm-cli.js")
    ? runCommand(process.execPath, [cli, ...args], cwd)
    : runCommand(process.platform === "win32" ? "npm.cmd" : "npm", args, cwd);
}

/** An existing installation may serve an active session: never overwrite one. */
export function freshPrefix(prefix) {
  const path = resolve(prefix);
  try {
    lstatSync(path);
  } catch (error) {
    if (error.code === "ENOENT") return path;
    throw error;
  }
  throw new Error(`Install prefix already exists: ${path}. Choose a new directory; active installs must stay untouched.`);
}

/** Replace only our symlink after verification; processes using its old target keep their files. */
export function activateInstall(prefix, current) {
  try {
    if (!lstatSync(current).isSymbolicLink()) throw new Error(`Refusing to replace a non-symlink: ${current}`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  mkdirSync(dirname(current), { recursive: true });
  const temporary = `${current}.${process.pid}.new`;
  symlinkSync(prefix, temporary, process.platform === "win32" ? "junction" : "dir");
  try {
    renameSync(temporary, current);
  } finally {
    rmSync(temporary, { force: true });
  }
}

/** Build and install a snapshot, with no writes to the checkout's dist/ or global npm install. */
export async function updateLocal({ root = ROOT, prefix, stateDir = join(homedir(), ".jev-gateway"), runCommand = run } = {}) {
  if (!existsSync(join(root, "src/index.ts"))) throw new Error("Run update-local from a checkout with development dependencies installed.");
  if (!existsSync(join(root, "node_modules/typescript"))) throw new Error("Install checkout development dependencies with pnpm install before running update-local.");
  const destination = freshPrefix(prefix ?? join(stateDir, "installs", `local-${Date.now()}-${process.pid}`));
  const staging = mkdtempSync(join(tmpdir(), "jev-update-"));
  let ownsDestination = false;
  try {
    for (const name of ["src", "test", "bin", "scripts", "package.json", "tsconfig.json", "tsconfig.build.json", "README.md", "LICENSE", "CHANGELOG.md", ".env.example"]) {
      cpSync(join(root, name), join(staging, name), { recursive: true });
    }
    symlinkSync(join(root, "node_modules"), join(staging, "node_modules"), process.platform === "win32" ? "junction" : "dir");
    await npm(["run", "typecheck"], staging, runCommand);
    await npm(["test"], staging, runCommand);
    await npm(["run", "build"], staging, runCommand);
    const pkg = JSON.parse(readFileSync(join(staging, "package.json"), "utf8"));
    await npm(["pack", "--ignore-scripts", "--pack-destination", staging], staging, runCommand);
    // The installed package has no source tree: compare the compiled snapshot with that package.
    rmSync(join(staging, "src"), { recursive: true });
    const expected = installationIdentity(staging);
    const tarball = join(staging, `${pkg.name}-${pkg.version}.tgz`);
    mkdirSync(dirname(destination), { recursive: true });
    // Claim the new directory exclusively: another updater may have created it since freshPrefix.
    mkdirSync(destination);
    ownsDestination = true;
    await npm(["install", "--global", "--prefix", destination, tarball, "--ignore-scripts", "--no-audit", "--no-fund"], staging, runCommand);
    const installedRoot = join(destination, process.platform === "win32" ? "node_modules" : "lib/node_modules", pkg.name);
    const installed = installationIdentity(installedRoot);
    if (installed.fingerprint !== expected.fingerprint) throw new Error("Installed code differs from the verified snapshot; activation skipped.");
    const providers = JSON.parse(readFileSync(join(installedRoot, "dist/providers.json"), "utf8"));
    if (!providers.ollama) throw new Error("Installed package is missing Ollama support; activation skipped.");
    for (const entry of Object.values(pkg.bin)) await runCommand(process.execPath, [join(installedRoot, entry), "--gateway-help"], staging, true);
    const verification = `const {loadConfig}=await import(${JSON.stringify(pathToFileURL(join(installedRoot, "dist/config.js")).href)});` +
      `const {createApp}=await import(${JSON.stringify(pathToFileURL(join(installedRoot, "dist/app.js")).href)});` +
      "const app=createApp({config:loadConfig({JEV_PROVIDER:'ollama'}),askJev:async()=>{throw Error('unused')}});" +
      "const response=await app.request('/health');if(response.status!==200)throw Error('health failed');";
    await runCommand(process.execPath, ["--input-type=module", "-e", verification], staging);
    const current = join(stateDir, "current");
    if (!prefix) activateInstall(destination, current);
    const bin = process.platform === "win32" ? destination : join(prefix ? destination : current, "bin");
    console.log(`Verified install: ${installedRoot}\nVersion: ${installed.version}; fingerprint: ${installed.fingerprint}\nLaunchers: ${bin}`);
    console.log("Active gateways were not restarted. Add the launcher directory to PATH, then restart gateways after active sessions finish.");
    return { ...installed, bin };
  } catch (error) {
    if (ownsDestination) rmSync(destination, { recursive: true, force: true });
    throw error;
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length && (args[0] !== "--prefix" || args.length !== 2)) {
    console.error("usage: npm run update-local -- [--prefix NEW_DIRECTORY]");
    process.exitCode = 1;
  } else {
    try {
      await updateLocal({ prefix: args[1] });
    } catch (error) {
      console.error(`update-local: ${error.message}`);
      process.exitCode = 1;
    }
  }
}
