import assert from "node:assert/strict";
import test from "node:test";
import { handleGgcAssistantRequest } from "../../apps/ggc/http.mjs";

function request(path) {
  return new Request(`https://getgascert.com${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-request-id": "route-test" },
    body: JSON.stringify({ message: "What does a CP42 cost?" }),
  });
}

test("serves the assistant on the mounted production route", async () => {
  const response = await handleGgcAssistantRequest(request("/api/assistant/v1/assist"));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.requestId, "route-test");
  assert.equal(typeof body.result, "object");
});

test("does not expose the unmounted internal route", async () => {
  const response = await handleGgcAssistantRequest(request("/v1/assist"));
  assert.equal(response.status, 404);
});
