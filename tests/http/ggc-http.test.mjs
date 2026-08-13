import assert from "node:assert/strict";
import test from "node:test";
import { handleGgcAssistantRequest } from "../../apps/ggc/http.mjs";

function post(message) {
  return new Request("https://assistant.example/v1/assist", {
    method: "POST",
    headers: { "content-type": "application/json", "x-request-id": "ggc-http-test" },
    body: JSON.stringify({ message }),
  });
}

test("serves approved GGC knowledge through the HTTP contract", async () => {
  const response = await handleGgcAssistantRequest(post("How much is a CP42 certificate?"));
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.requestId, "ggc-http-test");
  assert.equal(payload.result.route, "knowledge");
  assert.match(payload.result.response.text, /£249/);
});

test("preserves emergency precedence through the HTTP contract", async () => {
  const response = await handleGgcAssistantRequest(post("I smell gas and need a CP42"));
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.result.route, "emergency");
  assert.equal(payload.result.blocked, true);
  assert.match(payload.result.response.text, /0800\s+111\s+999/);
  assert.doesNotMatch(payload.result.response.text, /£249/);
});

test("accepts an augmented website envelope without contaminating service routing", async () => {
  const message = [
    "Use WEBSITE EXCERPTS as GetGasCert's current source of truth.",
    "CUSTOMER QUESTION:",
    "I operate an LPG mobile catering trailer. Which gas certificate do I need?",
    "WEBSITE EXCERPTS:",
    "This unrelated excerpt mentions CP42 fixed commercial kitchens.",
  ].join("\n");
  const response = await handleGgcAssistantRequest(post(message));
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.result.route, "knowledge");
  assert.match(payload.result.response.text, /CP44/i);
  assert.match(payload.result.response.text, /£199/);
});
