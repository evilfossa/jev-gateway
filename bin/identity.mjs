import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return files(path);
    return /\.(ts|js|mjs|json|html)$/.test(entry.name) ? [path] : [];
  });
}

/** Content identity distinguishes local builds that still share a release version. */
export function installationIdentity(root) {
  const mode = existsSync(join(root, "src/index.ts")) ? "source" : "package";
  const hash = createHash("sha256");
  const paths = [join(root, "package.json"), ...files(join(root, "bin")), ...files(join(root, mode === "source" ? "src" : "dist"))];
  for (const path of paths.sort()) hash.update(relative(root, path)).update("\0").update(readFileSync(path)).update("\0");
  const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  return { root, mode, version, fingerprint: hash.digest("hex").slice(0, 16) };
}
