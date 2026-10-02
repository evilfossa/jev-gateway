import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { serve } from "@hono/node-server";
import { codex, claude, opencode } from "../bin/clients.mjs";
import { installationIdentity } from "../bin/identity.mjs";

const SPECS = { codex, claude, opencode };
const PROMPTS = {
  en: "Read math.mjs and verify.mjs. Fix total so every item's price is multiplied by its quantity. Change only math.mjs, run node verify.mjs, then report the result. Work only in this directory; do not delegate or use network tools.",
  uk: "Прочитай math.mjs і verify.mjs. Виправ total, щоб ціна кожного товару множилася на його кількість. Зміни лише math.mjs, запусти node verify.mjs і повідом результат. Працюй лише в цій папці; не делегуй і не використовуй мережеві інструменти.",
};
const SOURCE = "export function total(items) {\n  return items.reduce((sum, item) => sum + item.price, 0);\n}\n";
const CHECK = "import assert from 'node:assert/strict';\nimport { total } from './math.mjs';\n" +
  "assert.equal(total([]), 0);\nassert.equal(total([{price: 3, quantity: 2}]), 6);\n" +
  "assert.equal(total([{price: 2.5, quantity: 3}, {price: 4, quantity: 0}]), 7.5);\n" +
  "assert.equal(total([{price: 3, quantity: 2}, {price: 4, quantity: 1}]), 10);\nconsole.log('verified');\n";

function run(command, args, { cwd, env = process.env, timeoutMs = 10_000, onLine } = {}) {
  return new Promise((done, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32" });
    let stdout = "";
    let pending = "";
    let timedOut = false;
    let killTimer;
    const timer = setTimeout(() => {
      timedOut = true;
      // The group contains only this test client and its tool subprocesses.
      try { process.platform === "win32" ? child.kill() : process.kill(-child.pid, "SIGTERM"); } catch {}
      killTimer = setTimeout(() => {
        try { process.platform === "win32" ? child.kill("SIGKILL") : process.kill(-child.pid, "SIGKILL"); } catch {}
      }, 2000);
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      pending += chunk;
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) onLine?.(line);
    });
    // Client errors may contain conversations or credentials. Keep only exit status, never persist them.
    child.stderr.resume();
    child.once("error", (error) => { clearTimeout(timer); clearTimeout(killTimer); reject(error); });
    child.once("close", (code) => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      if (pending) onLine?.(pending);
      done({ code, stdout, timedOut });
    });
  });
}

/** Retain protocol facts only, never the conversation or tool inputs. */
export function requestFacts(body) {
  const messages = Array.isArray(body.messages) ? body.messages : Array.isArray(body.input) ? body.input : [];
  const blocks = messages.flatMap((message) => Array.isArray(message.content) ? message.content : []);
  const system = Array.isArray(body.system) ? body.system : [];
  return {
    model: typeof body.model === "string" ? body.model : undefined,
    thinking: Boolean(body.thinking && body.thinking.type !== "disabled"),
    promptCache: [...system, ...blocks, ...(Array.isArray(body.tools) ? body.tools : [])].some((block) => Boolean(block.cache_control)),
    toolResult: messages.some((message) => message.type === "function_call_output" || message.type === "custom_tool_call_output" || message.role === "tool") || blocks.some((block) => block.type === "tool_result"),
  };
}

/** Count completed client actions without saving their text or arguments. */
export function recordClientEvent(facts, client, event) {
  const command = (value) => {
    if (typeof value !== "string") return;
    if (/\b(cat|sed|head|rg)\b/.test(value) && /math\.mjs|verify\.mjs/.test(value)) facts.read = true;
    if (/\bnode\s+verify\.mjs\b/.test(value)) facts.check = true;
  };
  if (client === "codex") {
    if (event.type === "turn.completed") facts.completed = true;
    if (event.type === "item.completed" && event.item) {
      const item = event.item;
      if (item.type === "agent_message") facts.final = true;
      if (item.type === "command_execution") { facts.toolCalls += 1; facts.toolResults += 1; command(item.command); }
      if (item.type === "file_change") { facts.edit = true; facts.toolCalls += 1; facts.toolResults += 1; }
    }
    return;
  }
  if (client === "claude") {
    if (event.type === "result") { facts.completed = !event.is_error; facts.final = !event.is_error; }
    for (const block of event.message?.content ?? []) {
      if (block.type === "thinking") facts.thinking = true;
      if (block.type === "tool_result") facts.toolResults += 1;
      if (block.type !== "tool_use") continue;
      facts.toolCalls += 1;
      if (block.name === "Read") facts.read = true;
      if (["Edit", "Write"].includes(block.name)) facts.edit = true;
      if (block.name === "Bash") command(block.input?.command);
    }
    return;
  }
  if (event.type === "text") facts.final = true;
  if (event.type === "step_finish") facts.completed = true;
  if (event.type === "tool_use") {
    facts.toolCalls += 1;
    if (event.part?.state?.status === "completed") facts.toolResults += 1;
    if (["read", "glob", "grep"].includes(event.part?.tool)) facts.read = true;
    if (["edit", "write", "apply_patch"].includes(event.part?.tool)) facts.edit = true;
    command(event.part?.state?.input?.command);
  }
}

async function inventory() {
  const result = {};
  for (const name of Object.keys(SPECS)) {
    try {
      const version = await run(name, ["--version"]);
      result[name] = { available: version.code === 0, version: version.stdout.trim() };
    } catch { result[name] = { available: false }; }
  }
  try {
    const auth = JSON.parse(readFileSync(join(process.env.CODEX_HOME ?? join(homedir(), ".codex"), "auth.json"), "utf8"));
    result.codex.auth = auth.auth_mode === "chatgpt" || auth.tokens ? "subscription" : auth.OPENAI_API_KEY ? "api_key" : "absent";
  } catch { result.codex.auth = process.env.OPENAI_API_KEY ? "api_key" : "absent"; }
  try {
    const auth = JSON.parse((await run("claude", ["auth", "status", "--json"])).stdout);
    result.claude.auth = auth.loggedIn ? auth.authMethod : "absent";
  } catch { result.claude.auth = process.env.ANTHROPIC_API_KEY ? "api_key" : "unknown"; }
  // The custom OpenAI-compatible launcher needs an API key; another provider's saved login cannot authorize it.
  result.opencode.auth = process.env.OPENAI_API_KEY ? "api_key" : "absent_for_gateway_provider";
  return result;
}

function clientArgs(client, origin, prompt) {
  if (client === "codex") return [
    "exec", "--ignore-user-config", ...codex.args(origin), "--ignore-rules", "--ephemeral", "--skip-git-repo-check",
    "--sandbox", "workspace-write", "-c", "features.multi_agent=false", "-c", 'model_reasoning_effort="low"', "--json", prompt,
  ];
  if (client === "claude") return [
    "--print", "--safe-mode", "--no-session-persistence", "--output-format", "stream-json", "--verbose",
    "--permission-mode", "acceptEdits", "--allowedTools", "Read,Edit,Write,Bash(node verify.mjs),Bash(cat math.mjs),Bash(cat verify.mjs)",
    "--effort", "low", prompt,
  ];
  return ["run", "--pure", "--format", "json", "--agent", "build", "--model", `jev-gateway/${process.env.JEV_OPENCODE_MODEL ?? "gpt-5"}`, prompt];
}

function close(server) {
  server.closeAllConnections?.();
  return new Promise((done) => server.close(done));
}

async function scenario(client, language, routing, modules, timeoutMs) {
  const project = mkdtempSync(join(tmpdir(), `jev-session-${client}-`));
  writeFileSync(join(project, "math.mjs"), SOURCE);
  writeFileSync(join(project, "verify.mjs"), CHECK);
  const observations = [];
  const facts = { toolCalls: 0, toolResults: 0, read: false, edit: false, check: false, final: false, completed: false, thinking: false };
  let gateway;
  let unavailable;
  try {
    const initial = await run(process.execPath, ["verify.mjs"], { cwd: project });
    if (initial.code === 0) throw new Error("Test fixture did not start broken");
    if (routing === "unavailable") {
      unavailable = createServer((_request, response) => { response.writeHead(503); response.end(); });
      await new Promise((done) => unavailable.listen(0, "127.0.0.1", done));
    }
    const config = modules.loadConfig({
      ...process.env, JEV_PROVIDER: "ollama", JEV_DIRECT_CALLS: "false", JEV_ROUTING: String(routing !== "off"),
      JEV_URL: unavailable ? `http://127.0.0.1:${unavailable.address().port}/api/generate` : process.env.JEV_URL,
      UPSTREAM_BASE_URL: SPECS[client].upstream(), UPSTREAM_API_KEY: "", ROUTER_API_KEY: "", ARGS_MODEL: "",
      JEV_CLIENT: client, JEV_LOG_FILE: "", JEV_DEBUG_DUMP_DIR: "",
    });
    const events = modules.createEventLog({ capacity: 10_000 });
    const app = modules.createApp({ config, askJev: modules.createAskJev(config), events, identity: modules.identity });
    gateway = serve({ hostname: "127.0.0.1", port: 0, fetch: async (request) => {
      if (request.method === "POST" && /\/(responses|messages|chat\/completions)$/.test(new URL(request.url).pathname)) {
        try { observations.push(requestFacts(await request.clone().json())); } catch {}
      }
      return app.fetch(request);
    } });
    if (!gateway.listening) await new Promise((done) => gateway.once("listening", done));
    const origin = `http://127.0.0.1:${gateway.address().port}`;
    const health = await (await fetch(`${origin}/health`)).json();
    if (health.status !== "ok" || health.identity.fingerprint !== modules.identity.fingerprint) throw new Error("Isolated gateway identity mismatch");
    console.log(`${client} ${language} routing=${routing}: gateway ${origin}`);
    const env = { ...process.env, ...SPECS[client].env?.(origin, process.env), DISABLE_AUTOUPDATER: "1" };
    // Inline settings apply only to this process, including agents that otherwise select their own provider.
    if (client === "opencode") {
      const inline = JSON.parse(env.OPENCODE_CONFIG_CONTENT);
      inline.agent = { build: { model: inline.model } };
      inline.permission = { "*": "deny", read: "allow", edit: "allow", bash: { "node verify.mjs": "allow" } };
      env.OPENCODE_CONFIG_CONTENT = JSON.stringify(inline);
    }
    const startedAt = performance.now();
    const result = await run(client, clientArgs(client, origin, PROMPTS[language]), {
      cwd: project, env, timeoutMs, onLine: (line) => {
        try { recordClientEvent(facts, client, JSON.parse(line)); } catch {}
      },
    });
    const durationMs = Math.round(performance.now() - startedAt);
    const verification = await run(process.execPath, ["verify.mjs"], { cwd: project });
    const fixtureUnchanged = readFileSync(join(project, "verify.mjs"), "utf8") === CHECK;
    // Route logging finishes after the response clone. Poll only this isolated in-memory app.
    for (let attempts = 0; attempts < 20 && events.last < observations.length; attempts++) await new Promise((done) => setTimeout(done, 25));
    const routes = events.since(0);
    const sum = (pick) => routes.reduce((total, event) => total + (pick(event) ?? 0), 0);
    const count = (values) => Object.fromEntries([...new Set(values)].map((value) => [value, values.filter((item) => item === value).length]));
    const measured = routes.filter((event) => event.jev?.inference?.requests !== undefined);
    const failedChecks = Object.entries({
      clientExit: result.code === 0 && !result.timedOut, independentCheck: verification.code === 0 && fixtureUnchanged,
      read: facts.read, edit: facts.edit, check: facts.check, final: facts.final, completed: facts.completed,
      toolResults: facts.toolResults > 0, returnedToolResult: observations.some((entry) => entry.toolResult), gatewayTraffic: routes.length > 1,
    }).filter(([, passed]) => !passed).map(([name]) => name);
    const rejectedAuth = routes.find((event) => event.status === 401 || event.status === 403)?.status;
    const authReason = rejectedAuth ? `upstream_auth_http_${rejectedAuth}` : /not logged in|please run \/login|invalid api key|token.*expired/i.test(result.stdout)
      ? "upstream_auth_unavailable_in_client" : undefined;
    let outcome = failedChecks.length ? "failed" : "passed";
    if (authReason) outcome = "unverified";
    return {
      client, language, routing, outcome, reason: authReason, failedChecks, exitCode: result.code, timedOut: result.timedOut,
      taskVerified: verification.code === 0 && fixtureUnchanged, durationMs, session: facts,
      models: [...new Set(observations.map((entry) => entry.model).filter(Boolean))], upstream: config.upstreamBaseUrl,
      gateway: {
        requests: routes.length, requestsObserved: observations.length, modes: count(routes.map((event) => event.mode)),
        upstreamStatuses: count(routes.map((event) => event.status).filter((status) => status !== undefined)),
        reasons: count(routes.map((event) => event.reason).filter(Boolean)),
        inferenceRequests: measured.length ? sum((event) => event.jev?.inference?.requests) : undefined,
        routingLatencyMs: routes.some((event) => event.jev) ? sum((event) => event.jev?.latencyMs) : undefined,
        loadMs: routes.some((event) => event.jev?.inference?.loadMs !== undefined) ? sum((event) => event.jev?.inference?.loadMs) : undefined,
        nativeTotalMs: routes.some((event) => event.jev?.inference?.totalMs !== undefined) ? sum((event) => event.jev?.inference?.totalMs) : undefined,
        upstreamUsage: routes.some((event) => event.usage) ? {
          input: sum((event) => event.usage?.input), output: sum((event) => event.usage?.output), cached: sum((event) => event.usage?.cached),
        } : undefined,
        thinkingRequests: observations.filter((entry) => entry.thinking).length,
        promptCacheRequests: observations.filter((entry) => entry.promptCache).length,
        toolResultRequests: observations.filter((entry) => entry.toolResult).length,
      },
    };
  } finally {
    if (gateway) await close(gateway);
    if (unavailable) await close(unavailable);
    rmSync(project, { recursive: true, force: true });
  }
}

/** Run the same bounded task through fresh gateways; save metadata only. */
export async function verifySessions({ gatewayRoot, output, clients = Object.keys(SPECS), languages = ["uk", "en"], routings = ["on", "off", "unavailable"], timeoutMs = 180_000 }) {
  const root = resolve(gatewayRoot);
  if (!existsSync(join(root, "dist/index.js"))) throw new Error("--gateway-root must be an isolated installation with compiled dist/");
  const module = (name) => import(pathToFileURL(join(root, `dist/${name}.js`)).href);
  const [app, config, jev, events] = await Promise.all([module("app"), module("config"), module("jev"), module("events")]);
  const modules = { ...app, ...config, ...jev, ...events, identity: installationIdentity(root) };
  const report = { createdAt: new Date().toISOString(), gateway: modules.identity, inventory: await inventory(), samplePerCell: 1, modelLoad: "not forced cold; existing Ollama models left loaded", scenarios: [] };
  const localConfig = modules.loadConfig({ ...process.env, JEV_PROVIDER: "ollama", ROUTER_API_KEY: "" });
  if (/\/api\/generate$/.test(localConfig.jevUrl)) {
    try {
      const base = localConfig.jevUrl.replace(/generate$/, "");
      const version = await (await fetch(`${base}version`, { signal: AbortSignal.timeout(2000) })).json();
      const running = await (await fetch(`${base}ps`, { signal: AbortSignal.timeout(2000) })).json();
      const model = running.models?.find((item) => item.name === localConfig.jevModel || item.model === localConfig.jevModel);
      report.ollama = {
        version: version.version, model: localConfig.jevModel, loadedBeforeRun: Boolean(model), digest: model?.digest,
        quantization: model?.details?.quantization_level, contextLength: model?.context_length,
      };
    } catch { report.ollama = { model: localConfig.jevModel, status: "availability_unverified" }; }
  }
  writeFileSync(output, JSON.stringify(report, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  const unavailableAuth = new Map();
  for (const client of clients) for (const language of languages) for (const routing of routings) {
    const installed = report.inventory[client];
    let result;
    if (!installed.available || installed.auth.startsWith("absent") || installed.auth === "unknown" || unavailableAuth.has(client)) {
      let reason = `upstream_auth_${installed.auth}`;
      if (!installed.available) reason = "client_not_installed";
      if (unavailableAuth.has(client)) reason = unavailableAuth.get(client);
      result = { client, language, routing, outcome: "unverified", reason };
    } else {
      console.log(`${client} ${language} routing=${routing}: starting isolated session`);
      try { result = await scenario(client, language, routing, modules, timeoutMs); }
      catch { result = { client, language, routing, outcome: "failed", reason: "session_setup_or_execution_failed" }; }
      if (result.outcome === "unverified") unavailableAuth.set(client, result.reason);
    }
    report.scenarios.push(result);
    writeFileSync(output, JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
    console.log(`${client} ${language} routing=${routing}: ${result.outcome}${result.durationMs === undefined ? "" : ` (${result.durationMs} ms)`}`);
  }
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    const options = {};
    for (let index = 0; index < args.length; index += 2) {
      const value = args[index + 1];
      if (!value) throw new Error("Each option requires a value");
      if (args[index] === "--gateway-root") options.gatewayRoot = value;
      else if (args[index] === "--output") options.output = value;
      else if (args[index] === "--client") options.clients = value.split(",");
      else if (args[index] === "--language") options.languages = value.split(",");
      else if (args[index] === "--routing") options.routings = value.split(",");
      else if (args[index] === "--timeout-ms") options.timeoutMs = Number(value);
      else throw new Error("Unknown option");
    }
    if (!options.gatewayRoot || !options.output || options.clients?.some((name) => !SPECS[name]) ||
      options.languages?.some((name) => !PROMPTS[name]) || options.routings?.some((name) => !["on", "off", "unavailable"].includes(name)) ||
      options.timeoutMs !== undefined && (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0)) {
      throw new Error("usage: node scripts/verify-nimble-sessions.mjs --gateway-root ISOLATED_INSTALL --output NEW_JSON [--client codex,claude,opencode] [--language uk,en] [--routing on,off,unavailable] [--timeout-ms 180000]");
    }
    const report = await verifySessions(options);
    if (report.scenarios.some((entry) => entry.outcome === "failed")) process.exitCode = 1;
  } catch (error) {
    console.error(`verify-nimble-sessions: ${error.message}`);
    process.exitCode = 1;
  }
}
