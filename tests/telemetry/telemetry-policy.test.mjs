import assert from "node:assert/strict";
import test from "node:test";
import { createTelemetryEvent, recordTelemetry } from "../../packages/telemetry-policy/index.mjs";

test("creates an allowlisted telemetry event without request content", () => {
  const event = createTelemetryEvent({
    outcome: "assistant-response",
    status: 200,
    durationMs: 12.6,
    requestId: "request-123",
    message: "private customer text",
    ip: "203.0.113.1",
    origin: "https://example.com",
  });

  assert.deepEqual(Object.keys(event), [
    "version",
    "service",
    "outcome",
    "status",
    "durationMs",
    "requestId",
    "recordedAt",
  ]);
  assert.equal(event.durationMs, 13);
  assert.equal(event.requestId, "request-123");
  assert.equal("message" in event, false);
  assert.equal("ip" in event, false);
  assert.equal("origin" in event, false);
  assert.equal(Object.isFrozen(event), true);
});

test("telemetry is optional and failures do not escape", async () => {
  const event = createTelemetryEvent({ outcome: "health", status: 200 });
  assert.equal(await recordTelemetry(undefined, event), false);
  assert.equal(await recordTelemetry({ write: async () => { throw new Error("offline"); } }, event), false);

  const written = [];
  assert.equal(await recordTelemetry({ write: async (value) => written.push(value) }, event), true);
  assert.deepEqual(written, [event]);
});
