import { closeSync, fstatSync, openSync, readSync } from "node:fs";

/**
 * What the dashboard knows about one routed request. Built field by field from a log entry and
 * never by spreading it: a `direct` decision carries the tool's arguments, and those — like
 * prompts, bodies and credentials — must not reach a browser.
 */
export interface RouteEvent {
  seq: number;
  time: string;
  path: string;
  model?: string;
  tools: number;
  mode: string;
  reason?: string;
  tool?: string;
  confidence?: number;
  /** Upstream HTTP status; absent for `direct`, which never calls upstream. */
  status?: number;
  /** How long the whole request took, reply included. */
  durationMs?: number;
  /** What the LLM call cost, as the provider reported it; absent for `direct` and failed calls. */
  usage?: { input: number; output: number; cached: number; cacheWrite: number; reasoning: number };
  /** Selection or measured partial work, including local failures before an answer. */
  jev?: {
    provider?: string;
    model?: string;
    choice?: string;
    confidence?: number;
    latencyMs?: number;
    inputTokens?: number;
    shortlist?: string[];
    inference?: { requests?: number; loadMs?: number; promptEvalMs?: number; evalMs?: number; totalMs?: number };
  };
}

export interface EventLog {
  record(entry: Record<string, unknown>): void;
  /** Events newer than `seq`, oldest first. */
  since(seq: number): RouteEvent[];
  /** Sequence number of the newest event: how many were ever recorded, history included. */
  readonly last: number;
}

const DEFAULT_CAPACITY = 1000;
/** Enough of a log's tail to fill the buffer; a Claude Code line with a shortlist is ~1 kB. */
const HISTORY_BYTES = 2 * 1024 * 1024;

const text = (value: unknown, max = 200) => (typeof value === "string" ? value.slice(0, max) : undefined);
const number = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : undefined);
const nonNegative = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;

function toEvent(entry: Record<string, unknown>, seq: number): RouteEvent | undefined {
  const mode = text(entry.mode);
  if (entry.event !== "route" || !mode) return undefined;
  const jev = entry.jev && typeof entry.jev === "object" ? (entry.jev as Record<string, unknown>) : undefined;
  const usage = entry.usage && typeof entry.usage === "object" ? (entry.usage as Record<string, unknown>) : undefined;
  const inference = jev?.inference && typeof jev.inference === "object" ? jev.inference as Record<string, unknown> : undefined;
  return {
    seq,
    time: text(entry.time) ?? new Date().toISOString(),
    path: text(entry.path) ?? "",
    model: text(entry.model),
    tools: number(entry.tools) ?? 0,
    mode,
    reason: text(entry.reason),
    tool: text(entry.tool),
    confidence: number(entry.confidence),
    status: number(entry.status),
    durationMs: number(entry.durationMs),
    usage: usage && {
      input: number(usage.input) ?? 0,
      output: number(usage.output) ?? 0,
      cached: number(usage.cached) ?? 0,
      cacheWrite: number(usage.cacheWrite) ?? 0,
      reasoning: number(usage.reasoning) ?? 0,
    },
    jev: jev && {
      provider: text(jev.provider),
      model: text(jev.model),
      choice: text(jev.choice),
      confidence: number(jev.confidence),
      latencyMs: nonNegative(jev.latencyMs),
      inputTokens: nonNegative(jev.inputTokens),
      shortlist: Array.isArray(jev.shortlist) ? jev.shortlist.flatMap((name) => text(name) ?? []) : undefined,
      inference: inference && {
        requests: nonNegative(inference.requests),
        loadMs: nonNegative(inference.loadMs),
        promptEvalMs: nonNegative(inference.promptEvalMs),
        evalMs: nonNegative(inference.evalMs),
        totalMs: nonNegative(inference.totalMs),
      },
    },
  };
}

/** The last `bytes` of a JSON-lines file, parsed; anything unreadable is skipped. */
function readTail(file: string, bytes: number): Record<string, unknown>[] {
  let fd: number | undefined;
  try {
    fd = openSync(file, "r");
    const { size } = fstatSync(fd);
    const start = Math.max(0, size - bytes);
    const buffer = Buffer.alloc(size - start);
    readSync(fd, buffer, 0, buffer.length, start);
    const lines = buffer.toString("utf8").split("\n");
    // Starting mid-file means starting mid-line.
    if (start > 0) lines.shift();
    return lines.flatMap((line) => {
      if (!line.startsWith("{")) return [];
      try {
        return [JSON.parse(line) as Record<string, unknown>];
      } catch {
        return [];
      }
    });
  } catch {
    // No history yet, or not ours to read: the dashboard just starts empty.
    return [];
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/**
 * The newest route events, in memory. `historyFile` is a JSON-lines log of an earlier run (the
 * launchers append the router's stdout to one): replayed once, so a restart doesn't blank the
 * dashboard.
 */
export function createEventLog({ capacity = DEFAULT_CAPACITY, historyFile }: { capacity?: number; historyFile?: string } = {}): EventLog {
  const events: RouteEvent[] = [];
  let last = 0;
  const record = (entry: Record<string, unknown>) => {
    const event = toEvent(entry, last + 1);
    if (!event) return;
    last = event.seq;
    events.push(event);
    if (events.length > capacity) events.shift();
  };
  if (historyFile) for (const entry of readTail(historyFile, HISTORY_BYTES)) record(entry);
  return {
    record,
    since: (seq) => events.filter((event) => event.seq > seq),
    get last() {
      return last;
    },
  };
}
