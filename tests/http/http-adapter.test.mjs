import assert from "node:assert/strict";
import test from "node:test";
import { createAssistantHttpHandler } from "../../packages/http-adapter/index.mjs";

function request(path = "/v1/assist", options = {}) {
  return new Request(`https://assistant.example${path}`, options);
}

const assistant = async (message) => ({ route: "knowledge", message });
const handle = createAssistantHttpHandler({ assistant, maximumInputLength: 20 });

test("accepts a valid assistant request", async () => {
  const response = await handle(request("/v1/assist", {
    method: "POST",
    headers: { "content-type": "application/json", "x-request-id": "test-123" },
    body: JSON.stringify({ message: "CP42 price" }),
  }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), {
    requestId: "test-123",
    result: { route: "knowledge", message: "CP42 price" },
  });
});

test("rejects unknown routes and non-POST methods", async () => {
  assert.equal((await handle(request("/unknown", { method: "POST" }))).status, 404);
  const response = await handle(request("/v1/assist", { method: "GET" }));
  assert.equal(response.status, 405);
  assert.equal(response.headers.get("allow"), "POST");
});

test("requires JSON with a string message", async () => {
  assert.equal((await handle(request("/v1/assist", { method: "POST", body: "{}" }))).status, 415);
  assert.equal((await handle(request("/v1/assist", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "not-json",
  }))).status, 400);
  assert.equal((await handle(request("/v1/assist", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: 42 }),
  }))).status, 400);
});

test("rejects oversized messages", async () => {
  const response = await handle(request("/v1/assist", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: "x".repeat(21) }),
  }));
  assert.equal(response.status, 413);
});

test("fails closed without leaking assistant errors", async () => {
  const failing = createAssistantHttpHandler({ assistant: async () => { throw new Error("secret"); } });
  const response = await failing(request("/v1/assist", {
    method: "POST",
    headers: { "content-type": "application/json", "x-request-id": "failure-1" },
    body: JSON.stringify({ message: "hello" }),
  }));
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "assistant-failure", requestId: "failure-1" });
});
