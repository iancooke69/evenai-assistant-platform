import assert from "node:assert/strict";
import test from "node:test";
import worker from "../../apps/ggc/worker.mjs";

function request(path, init = {}) {
  return new Request(`https://assistant.example${path}`, init);
}

test("health remains available while the assistant is disabled", async () => {
  const response = await worker.fetch(request("/health"), {
    ENABLE_PUBLIC_ASSISTANT: "false",
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.publicAssistantEnabled, false);
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("assistant endpoint is fail-closed by default", async () => {
  const response = await worker.fetch(request("/v1/assist", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: "How much is a CP42?" }),
  }), {});
  const body = await response.json();

  assert.equal(response.status, 503);
  assert.equal(body.error, "assistant_unavailable");
});

test("enabled Worker delegates to the approved GGC HTTP adapter", async () => {
  const response = await worker.fetch(request("/v1/assist", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: "How much is a CP42?" }),
  }), {
    ENABLE_PUBLIC_ASSISTANT: "true",
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.result.response.type, "knowledge");
  assert.match(body.result.response.text, /£299/);
});

test("emergency precedence is preserved by the Worker entrypoint", async () => {
  const response = await worker.fetch(request("/v1/assist", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: "I smell gas and also need a CP42" }),
  }), {
    ENABLE_PUBLIC_ASSISTANT: "true",
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.result.route, "emergency");
  assert.equal(body.result.blocked, true);
  assert.doesNotMatch(body.result.response.text, /£299/);
});
