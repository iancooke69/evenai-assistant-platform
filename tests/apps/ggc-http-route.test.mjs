import assert from "node:assert/strict";
import test from "node:test";
import { GGC_ASSISTANT_ROUTE } from "../../apps/ggc/http.mjs";
import { createAssistantHttpHandler } from "../../packages/http-adapter/index.mjs";

function request(path) {
  return new Request(`https://getgascert.com${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-request-id": "route-test" },
    body: JSON.stringify({ message: "What does a CP42 cost?" }),
  });
}

const handle = createAssistantHttpHandler({
  assistant: async (message) => ({ message }),
  route: GGC_ASSISTANT_ROUTE,
});

test("declares the exact mounted production route", () => {
  assert.equal(GGC_ASSISTANT_ROUTE, "/api/assistant/v1/assist");
});

test("serves requests on the mounted production route", async () => {
  const response = await handle(request(GGC_ASSISTANT_ROUTE));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.requestId, "route-test");
  assert.deepEqual(body.result, { message: "What does a CP42 cost?" });
});

test("does not expose the unmounted internal route", async () => {
  const response = await handle(request("/v1/assist"));
  assert.equal(response.status, 404);
});
