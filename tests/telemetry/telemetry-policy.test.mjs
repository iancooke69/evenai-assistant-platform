import assert from "node:assert/strict";
import test from "node:test";
import { createTelemetryEvent, recordTelemetry } from "../../packages/telemetry-policy/index.mjs";

const requestId = "123e4567-e89b-42d3-a456-426614174000";

test("creates an allowlisted telemetry event without request content", () => {
  const event = createTelemetryEvent({
    outcome: "assistant-response",
    status: 200,
    durationMs: 12.6,
    requestId,
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
  assert.equal(event.requestId, requestId);
  assert.equal("message" in event, false);
  assert.equal("ip" in event, false);
  assert.equal("origin" in event, false);
  assert.equal(Object.isFrozen(event), true);
});

test("rejects arbitrary caller-controlled request identifiers", () => {
  const event = createTelemetryEvent({
    outcome: "assistant-response",
    status: 200,
    requestId: "customer-name-or-email@example.com",
  });

  assert.equal(event.requestId, null);
});

test("telemetry is optional and failures do not escape", async () => {
  const event = createTelemetryEvent({ outcome: "health", status: 200 });
  assert.equal(await recordTelemetry(undefined, event), false);
  assert.equal(await recordTelemetry({ write: async () => { throw new Error("offline"); } }, event), false);

  const written = [];
  assert.equal(await recordTelemetry({ write: async (value) => written.push(value) }, event), true);
  assert.deepEqual(written, [event]);
});
