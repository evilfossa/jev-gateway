import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
// @ts-ignore: development scripts are plain ESM.
import { activateInstall, freshPrefix, updateLocal } from "../scripts/update-local.mjs";

const directories: string[] = [];
function directory() {
  const path = mkdtempSync(join(tmpdir(), "jev-update-test-"));
  directories.push(path);
  return path;
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true });
});

function checkout(base: string) {
  const root = join(base, "checkout");
  for (const name of ["src", "test", "bin", "scripts", "node_modules/typescript"]) mkdirSync(join(root, name), { recursive: true });
  for (const name of ["tsconfig.json", "tsconfig.build.json", "README.md", "LICENSE", "CHANGELOG.md", ".env.example"]) {
    writeFileSync(join(root, name), "{}");
  }
  writeFileSync(join(root, "src/index.ts"), "export {};");
  writeFileSync(join(root, "bin/jev-test.mjs"), "export {};");
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "jev-gateway", version: "0.0.0", bin: { "jev-test": "bin/jev-test.mjs" } }));
  return root;
}

function commands(failure?: "checks" | "fingerprint" | "health") {
  let snapshot = "";
  const runCommand = async (_command: string, args: string[], cwd: string) => {
    snapshot = cwd;
    if (failure === "checks") throw new Error("checks failed");
    if (args.includes("build")) {
      mkdirSync(join(cwd, "dist"));
      writeFileSync(join(cwd, "dist/index.js"), "export {};");
      writeFileSync(join(cwd, "dist/providers.json"), JSON.stringify({ ollama: {} }));
    }
    if (args.includes("install")) {
      const prefix = args[args.indexOf("--prefix") + 1]!;
      const installed = join(prefix, process.platform === "win32" ? "node_modules" : "lib/node_modules", "jev-gateway");
      mkdirSync(installed, { recursive: true });
      for (const name of ["package.json", "bin", "dist"]) cpSync(join(cwd, name), join(installed, name), { recursive: true });
      if (failure === "fingerprint") writeFileSync(join(installed, "dist/index.js"), "changed");
    }
    if (failure === "health" && args.includes("--input-type=module")) throw new Error("health failed");
  };
  return { runCommand, snapshot: () => snapshot };
}

describe("isolated local updates", () => {
  it("refuses existing installations, including broken symlinks", () => {
    const base = directory();
    expect(() => freshPrefix(base)).toThrow("already exists");
    const broken = join(base, "broken");
    symlinkSync(join(base, "missing"), broken);
    expect(() => freshPrefix(broken)).toThrow("already exists");
    expect(freshPrefix(join(base, "new"))).toBe(join(base, "new"));
  });

  it("activates a new target while leaving the old installation available", () => {
    const base = directory();
    const old = join(base, "old");
    const next = join(base, "next");
    mkdirSync(old); mkdirSync(next);
    writeFileSync(join(old, "live"), "active process files");
    const current = join(base, "current");
    activateInstall(old, current);
    activateInstall(next, current);
    expect(readlinkSync(current)).toBe(next);
    activateInstall(old, current);
    expect(readlinkSync(current)).toBe(old);
    expect(readFileSync(join(old, "live"), "utf8")).toBe("active process files");
    expect(existsSync(next)).toBe(true);
    expect(() => freshPrefix(old)).toThrow("already exists");
  });

  it("never replaces user files or real directories during activation", () => {
    const base = directory();
    const current = join(base, "current");
    writeFileSync(current, "user data");
    expect(() => activateInstall(join(base, "new"), current)).toThrow("non-symlink");
    rmSync(current);
    mkdirSync(current);
    expect(() => activateInstall(join(base, "new"), current)).toThrow("non-symlink");
  });

  it("activates only after every check and removes its temporary snapshot", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const base = directory();
    const stateDir = join(base, "state");
    const old = join(base, "old");
    mkdirSync(old);
    activateInstall(old, join(stateDir, "current"));
    const runner = commands();
    const result = await updateLocal({ root: checkout(base), stateDir, runCommand: runner.runCommand });
    expect(readlinkSync(join(stateDir, "current"))).toBe(join(result.root, "../../.."));
    expect(existsSync(old)).toBe(true);
    expect(existsSync(runner.snapshot())).toBe(false);
  });

  it.each(["checks", "fingerprint", "health"] as const)("keeps the previous target when %s fails", async (failure) => {
    const base = directory();
    const stateDir = join(base, "state");
    const old = join(base, "old");
    mkdirSync(old);
    activateInstall(old, join(stateDir, "current"));
    const runner = commands(failure);
    await expect(updateLocal({ root: checkout(base), stateDir, runCommand: runner.runCommand })).rejects.toThrow();
    expect(readlinkSync(join(stateDir, "current"))).toBe(old);
    expect(existsSync(old)).toBe(true);
    expect(existsSync(runner.snapshot())).toBe(false);
    const installs = join(stateDir, "installs");
    expect(existsSync(installs) ? readdirSync(installs) : []).toEqual([]);
  });

  it("verifies an explicit prefix without activating it", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const base = directory();
    const stateDir = join(base, "state");
    const prefix = join(base, "install");
    await updateLocal({ root: checkout(base), prefix, stateDir, runCommand: commands().runCommand });
    expect(existsSync(prefix)).toBe(true);
    expect(existsSync(join(stateDir, "current"))).toBe(false);
  });
});
