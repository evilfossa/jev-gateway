import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { fakeJev, testConfig } from "./helpers.js";
// @ts-ignore: shared launcher modules are plain ESM.
import { doctor, publicUrl } from "../bin/doctor.mjs";
// @ts-ignore: shared launcher modules are plain ESM.
import { loadProviders } from "../bin/setup.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const options = {
  root, spec: { name: "jev-codex", client: "codex" }, origin: "http://gateway.test", providers: loadProviders(root),
  env: { JEV_PROVIDER: "ollama", JEV_MODEL: "nimble:latest", OLLAMA_BASE_URL: "http://ollama.test" },
  sources: { JEV_PROVIDER: "/checkout/.env" }, envFiles: ["/checkout/.env", "/shared/.env"],
};

describe("launcher diagnostics", () => {
  it("checks availability without inference or changing the gateway", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      calls.push({ url, init });
      return Response.json(url.endsWith("/health") ? { status: "ok", pid: 42, jev: "ollama" } : { version: "0.35.0" });
    };
    const report = await doctor({ ...options, fetchImpl });
    expect(report.ok).toBe(true);
    expect(report.lines.join("\n")).toContain("[/checkout/.env]");
    expect(report.lines.join("\n")).toContain("key: not required");
    expect(calls.map((call) => call.url)).toEqual([
      "http://gateway.test/health", "http://ollama.test/api/version", "http://ollama.test/api/show",
    ]);
    expect(JSON.parse(calls[2]!.init!.body as string)).toEqual({ model: "nimble:latest" });
  });

  it("reports a missing model and never prints credentials", async () => {
    const fetchImpl: typeof fetch = async (input) => String(input).endsWith("/show")
      ? new Response("secret upstream error", { status: 404 }) : Response.json({ version: "0.35.0" });
    const report = await doctor({ ...options, env: { ...options.env, OLLAMA_BASE_URL: "http://user:secret@ollama.test?key=secret" }, fetchImpl });
    expect(report.ok).toBe(false);
    expect(report.lines.join("\n")).toContain("missing; check ollama list");
    expect(report.lines.join("\n")).not.toContain("secret");
    expect(publicUrl("https://user:secret@example.test/v1?key=secret#secret")).toBe("https://example.test/v1");
  });

  it("reports an old running build without replacing it", async () => {
    const fetchImpl: typeof fetch = async () => Response.json({
      status: "ok", identity: { root: "/old/install", version: "0.5.0", fingerprint: "old" },
    });
    const report = await doctor({ ...options, fetchImpl });
    expect(report.lines.join("\n")).toContain("Running code differs");
  });

  it("captures running identity while keeping protected health minimal", async () => {
    const identity = { root: "/install", mode: "package", version: "0.5.0", fingerprint: "abc" };
    const app = createApp({ config: testConfig(), askJev: fakeJev({}).askJev, identity });
    expect((await (await app.request("/health")).json()).identity).toEqual(identity);
    const protectedApp = createApp({
      config: testConfig({ routerApiKey: "secret", upstreamApiKey: "upstream-secret" }), askJev: fakeJev({}).askJev, identity,
    });
    expect(await (await protectedApp.request("/health")).json()).toEqual({ status: "ok" });
  });
});
