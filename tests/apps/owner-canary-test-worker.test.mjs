import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createOwnerCanaryTestWorker } from "../../apps/ggc/owner-canary-test-worker.mjs";

const ownerToken = "private-owner-token";
const targetVersionId = "22222222-2222-4222-8222-222222222222";
const clientAddress = "203.0.113.42";

function tokenHash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function environment(overrides = {}) {
  return {
    TARGET_WORKER_NAME: "evenai-ggc-assistant",
    TARGET_VERSION_ID: targetVersionId,
    APPROVED_ORIGIN: "https://getgascert.com",
    OWNER_TOKEN_SHA256: tokenHash(ownerToken),
    ASSISTANT: {
      async fetch() {
        return new Response(JSON.stringify({
          result: { response: { text: "A CP42 certificate costs £299." } },
        }), {
          status: 200,
          headers: {
            "content-type": "application/json",
            "x-evenai-service": "evenai-ggc-assistant",
            "x-evenai-version-id": targetVersionId,
          },
        });
      },
    },
    ...overrides,
  };
}

function ownerRequest(
  message = "How much is a CP42 certificate?",
  token = ownerToken,
  includeClientIdentity = true,
) {
  const headers = {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    "x-request-id": "owner-test-request",
  };
  if (includeClientIdentity) headers["cf-connecting-ip"] = clientAddress;

  return new Request("https://owner-test.example.workers.dev/api/assist", {
    method: "POST",
    headers,
    body: JSON.stringify({ message }),
  });
}

test("serves a no-store owner test page without exposing the token", async () => {
  const worker = createOwnerCanaryTestWorker();
  const response = await worker.fetch(
    new Request("https://owner-test.example.workers.dev/"),
    environment(),
  );
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(
    response.headers.get("x-evenai-owner-test-gateway"),
    "evenai-ggc-owner-canary-test",
  );
  assert.match(html, /Protected GetGasCert canary test/);
  assert.doesNotMatch(html, new RegExp(ownerToken));
});

test("rejects unauthenticated requests before calling the service binding", async () => {
  let calls = 0;
  const worker = createOwnerCanaryTestWorker();
  const response = await worker.fetch(ownerRequest("test", "wrong-token"), environment({
    ASSISTANT: {
      async fetch() {
        calls += 1;
        throw new Error("must not be called");
      },
    },
  }));

  assert.equal(response.status, 401);
  assert.equal(calls, 0);
  assert.equal((await response.json()).error, "owner_authentication_required");
});

test("fails closed when Cloudflare client identity is unavailable", async () => {
  let calls = 0;
  const worker = createOwnerCanaryTestWorker();
  const response = await worker.fetch(ownerRequest("test", ownerToken, false), environment({
    ASSISTANT: {
      async fetch() {
        calls += 1;
        throw new Error("must not be called");
      },
    },
  }));

  assert.equal(response.status, 503);
  assert.equal(calls, 0);
  assert.equal((await response.json()).error, "client_identity_unavailable");
});

test("routes an authenticated request to the exact canary with rate-limit identity", async () => {
  let downstreamRequest;
  const worker = createOwnerCanaryTestWorker();
  const response = await worker.fetch(ownerRequest(), environment({
    ASSISTANT: {
      async fetch(request) {
        downstreamRequest = request;
        return new Response(JSON.stringify({
          result: { response: { text: "A CP42 certificate costs £299." } },
        }), {
          status: 200,
          headers: {
            "content-type": "application/json",
            "x-evenai-service": "evenai-ggc-assistant",
            "x-evenai-version-id": targetVersionId,
            "x-request-id": "owner-test-request",
          },
        });
      },
    },
  }));

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-evenai-version-id"), targetVersionId);
  assert.equal(downstreamRequest.headers.get("origin"), "https://getgascert.com");
  assert.equal(downstreamRequest.headers.get("x-real-ip"), clientAddress);
  assert.equal(downstreamRequest.headers.get("cf-connecting-ip"), clientAddress);
  assert.equal(downstreamRequest.headers.get("authorization"), null);
  assert.equal(
    downstreamRequest.headers.get("Cloudflare-Workers-Version-Overrides"),
    `evenai-ggc-assistant="${targetVersionId}"`,
  );
  assert.deepEqual(await downstreamRequest.json(), {
    message: "How much is a CP42 certificate?",
  });
  assert.deepEqual(await response.json(), {
    result: { response: { text: "A CP42 certificate costs £299." } },
  });
});

test("fails closed when the downstream response is not from the exact canary", async () => {
  const worker = createOwnerCanaryTestWorker();
  const response = await worker.fetch(ownerRequest(), environment({
    ASSISTANT: {
      async fetch() {
        return new Response(JSON.stringify({ error: "assistant_unavailable" }), {
          status: 503,
          headers: {
            "content-type": "application/json",
            "x-evenai-service": "evenai-ggc-assistant",
            "x-evenai-version-id": "11111111-1111-4111-8111-111111111111",
          },
        });
      },
    },
  }));

  assert.equal(response.status, 502);
  assert.equal((await response.json()).error, "canary_target_mismatch");
});
