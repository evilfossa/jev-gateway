/** Measured Ollama generate requests and native durations, aggregated in milliseconds. */
export interface InferenceMetrics {
  requests: number;
  loadMs?: number;
  promptEvalMs?: number;
  evalMs?: number;
  totalMs?: number;
}

/** Missing timings stay absent, including when only part of a decision completed. */
export function addInference(previous: InferenceMetrics | undefined, next: InferenceMetrics): InferenceMetrics {
  const sum = (a: number | undefined, b: number | undefined) => a === undefined && b === undefined ? undefined : (a ?? 0) + (b ?? 0);
  return {
    requests: (previous?.requests ?? 0) + next.requests,
    loadMs: sum(previous?.loadMs, next.loadMs),
    promptEvalMs: sum(previous?.promptEvalMs, next.promptEvalMs),
    evalMs: sum(previous?.evalMs, next.evalMs),
    totalMs: sum(previous?.totalMs, next.totalMs),
  };
}
