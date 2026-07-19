const ALLOWED_OUTCOMES = new Set([
  "health",
  "disabled",
  "origin-rejected",
  "preflight",
  "rate-limited",
  "limiter-unavailable",
  "assistant-response",
]);

export function createTelemetryEvent(input = {}) {
  const outcome = ALLOWED_OUTCOMES.has(input.outcome) ? input.outcome : "assistant-response";
  const status = Number.isInteger(input.status) ? input.status : 500;
  const durationMs = Number.isFinite(input.durationMs) && input.durationMs >= 0
    ? Math.round(input.durationMs)
    : 0;

  return Object.freeze({
    version: 1,
    service: "evenai-ggc-assistant",
    outcome,
    status,
    durationMs,
    requestId: typeof input.requestId === "string" && input.requestId.length <= 128
      ? input.requestId
      : null,
    recordedAt: new Date().toISOString(),
  });
}

export async function recordTelemetry(binding, event) {
  if (typeof binding?.write !== "function") return false;
  try {
    await binding.write(event);
    return true;
  } catch {
    return false;
  }
}
