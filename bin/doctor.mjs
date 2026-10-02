import { accessSync, constants, realpathSync } from "node:fs";
import { delimiter, join } from "node:path";
import { installationIdentity } from "./identity.mjs";

/** Resolve a command without executing it or printing unrelated process arguments. */
export function commandPath(command, env = process.env) {
  for (const directory of (env.PATH ?? "").split(delimiter)) {
    for (const suffix of process.platform === "win32" ? [".cmd", ".exe", ""] : [""]) {
      const path = join(directory, command + suffix);
      try {
        accessSync(path, constants.X_OK);
        return realpathSync(path);
      } catch { /* Try the next PATH entry. */ }
    }
  }
}

/** URLs may carry credentials; diagnostics keep only the origin and path. */
export function publicUrl(value) {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return "invalid URL";
  }
}

async function probe(url, init, fetchImpl) {
  try {
    const response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(3_000) });
    if (!response.ok) return { ok: false, status: response.status };
    return { ok: true, data: await response.json() };
  } catch {
    // Do not print network errors: some include a credential-bearing URL.
    return { ok: false };
  }
}

/** Read-only: no setup, inference, gateway start, restart or routing toggle. */
export async function doctor({ root, spec, origin, env = process.env, sources = {}, envFiles = [], providers, fetchImpl = fetch }) {
  const identity = installationIdentity(root);
  const explicit = env.JEV_PROVIDER?.trim().toLowerCase() || undefined;
  const provider = explicit ?? Object.keys(providers).find((id) => providers[id].keyEnv && env[providers[id].keyEnv]?.trim()) ?? "typesafe";
  const row = providers[provider];
  const lines = [
    `${spec.name} doctor`,
    `install: ${identity.root} (${identity.mode})`,
    `version: ${identity.version}; fingerprint: ${identity.fingerprint}; node: ${process.version}`,
    `PATH launcher: ${commandPath(spec.name, env) ?? "not found"}`,
    `client: ${commandPath(spec.client, env) ?? "not found"}`,
    `config precedence: environment > ${envFiles.join(" > ")} > defaults`,
    `JEV_PROVIDER: ${provider} [${sources.JEV_PROVIDER ?? (explicit ? "environment" : "key/default selection")}]`,
  ];
  if (!row) return { ok: false, lines: [...lines, "Unknown provider; update this installation or correct JEV_PROVIDER."] };
  const model = env.JEV_MODEL?.trim() || row.model;
  lines.push(`JEV_MODEL requested: ${model} [${sources.JEV_MODEL ?? "default"}]`);
  const endpoint = env.JEV_URL?.trim() || (provider === "ollama" ? `${(env.OLLAMA_BASE_URL?.trim() || "http://127.0.0.1:11434").replace(/\/+$/, "")}/api/generate` : row.url);
  lines.push(`selector endpoint: ${publicUrl(endpoint)} [${sources.JEV_URL ?? sources.OLLAMA_BASE_URL ?? "default"}]`);
  lines.push(`key: ${row.keyEnv ? `${row.keyEnv} ${env[row.keyEnv]?.trim() ? "present" : "missing"}` : "not required"}`);
  const running = await probe(`${origin}/health`, {}, fetchImpl);
  lines.push(`gateway: ${publicUrl(origin)} ${running.ok ? "running" : "not reachable (doctor does not start it)"}`);
  if (running.ok) {
    const info = running.data ?? {};
    if (info.pid) lines.push(`running PID: ${info.pid}; provider: ${info.jev ?? "unknown"}; model: ${info.jevModel ?? "not reported"}`);
    if (info.identity) {
      lines.push(`running install: ${info.identity.root}; version: ${info.identity.version}; fingerprint: ${info.identity.fingerprint}`);
      if (info.identity.fingerprint !== identity.fingerprint) lines.push("Running code differs from this launcher. Restart later, after your active sessions finish.");
    } else lines.push("Running gateway does not report its build identity. It may predate --doctor; leave active sessions running.");
  }
  if (provider !== "ollama") return { ok: !row.keyEnv || Boolean(env[row.keyEnv]?.trim()), lines };
  const base = endpoint.replace(/\/api\/generate\/?$/, "");
  const [version, modelInfo] = await Promise.all([
    probe(`${base}/api/version`, {}, fetchImpl),
    probe(`${base}/api/show`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model }) }, fetchImpl),
  ]);
  lines.push(`Ollama: ${version.ok ? version.data.version ?? "unknown version" : "not reachable"}`);
  lines.push(`model ${model}: ${modelInfo.ok ? "available" : modelInfo.status === 404 ? "missing; check ollama list" : "unavailable; check Ollama and endpoint"}`);
  lines.push("No inference was run. Availability does not verify Nimble's checkpoint or logprob support.");
  return { ok: version.ok && modelInfo.ok, lines };
}
