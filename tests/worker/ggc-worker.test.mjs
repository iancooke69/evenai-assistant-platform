import assert from "node:assert/strict";
import test from "node:test";
import worker from "../../apps/ggc/worker.mjs";

const allowedOrigin = "https://www.getgascert.com";

function request(path, init = {}) {
  const headers = new Headers(init.headers);
  headers.set("cf-connecting-ip", headers.get("cf-connecting-ip") ?? "203.0.113.10");
  return new Request(`https://assistant.example${path}`, { ...init, headers });
}

function limiter(success = true) {
  return { limit: async () => ({ success }) };
}

function enabledEnv(overrides = {}) {
  return {
    ENABLE_PUBLIC_ASSISTANT: "true",
    ALLOWED_ORIGINS: `${allowedOrigin}, https://getgascert.com`,
    RATE_LIMITER: limiter(true),
    ...overrides,
  };
}

test("health remains available while the assistant is disabled", async () => {
  const response = await worker.fetch(request("/health"), {
    ENABLE_PUBLIC_ASSISTANT: "false",
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.publicAssistantEnabled, false);
  assert.equal(body.rateLimiterConfigured, false);
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("assistant endpoint is fail-closed by default", async () => {
  const response = await worker.fetch(request("/v1/assist", {
    method: "POST",
    headers: { "content-type": "application/json", origin: allowedOrigin },
    body: JSON.stringify({ message: "How much is a CP42?" }),
  }), {});
  const body = await response.json();

  assert.equal(response.status, 503);
  assert.equal(body.error, "assistant_unavailable");
});

test("enabled Worker rejects missing and unapproved origins", async () => {
  const missing = await worker.fetch(request("/v1/assist", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: "How much is a CP42?" }),
  }), enabledEnv());
  assert.equal(missing.status, 403);

  const rejected = await worker.fetch(request("/v1/assist", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://attacker.example" },
    body: JSON.stringify({ message: "How much is a CP42?" }),
  }), enabledEnv());
  assert.equal(rejected.status, 403);
  assert.equal((await rejected.json()).error, "origin_not_allowed");
});

test("approved preflight receives a constrained CORS policy", async () => {
  const response = await worker.fetch(request("/v1/assist", {
    method: "OPTIONS",
    headers: { origin: allowedOrigin },
  }), enabledEnv());

  assert.equal(response.status, 204);
  assert.equal(response.headers.get("access-control-allow-origin"), allowedOrigin);
  assert.equal(response.headers.get("access-control-allow-methods"), "POST, OPTIONS");
  assert.equal(response.headers.get("vary"), "Origin");
});

test("enabled Worker fails closed when the rate limiter is unavailable", async () => {
  const response = await worker.fetch(request("/v1/assist", {
    method: "POST",
    headers: { "content-type": "application/json", origin: allowedOrigin },
    body: JSON.stringify({ message: "How much is a CP42?" }),
  }), enabledEnv({ RATE_LIMITER: undefined }));
  const body = await response.json();

  assert.equal(response.status, 503);
  assert.equal(body.error, "rate-limiter-unavailable");
  assert.equal(response.headers.get("retry-after"), "60");
});

test("enabled Worker returns 429 when the request limit is exceeded", async () => {
  const response = await worker.fetch(request("/v1/assist", {
    method: "POST",
    headers: { "content-type": "application/json", origin: allowedOrigin },
    body: JSON.stringify({ message: "How much is a CP42?" }),
  }), enabledEnv({ RATE_LIMITER: limiter(false), RATE_LIMIT_RETRY_AFTER_SECONDS: "90" }));
  const body = await response.json();

  assert.equal(response.status, 429);
  assert.equal(body.error, "rate-limit-exceeded");
  assert.equal(response.headers.get("retry-after"), "90");
  assert.equal(response.headers.get("access-control-allow-origin"), allowedOrigin);
});

test("enabled Worker delegates approved and permitted requests", async () => {
  const response = await worker.fetch(request("/v1/assist", {
    method: "POST",
    headers: { "content-type": "application/json", origin: allowedOrigin },
    body: JSON.stringify({ message: "How much is a CP42?" }),
  }), enabledEnv());
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.result.response.type, "knowledge");
  assert.match(body.result.response.text, /£299/);
  assert.equal(response.headers.get("access-control-allow-origin"), allowedOrigin);
});

test("emergency precedence is preserved by the Worker entrypoint", async () => {
  const response = await worker.fetch(request("/v1/assist", {
    method: "POST",
    headers: { "content-type": "application/json", origin: allowedOrigin },
    body: JSON.stringify({ message: "I smell gas and also need a CP42" }),
  }), enabledEnv());
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.result.route, "emergency");
  assert.equal(body.result.blocked, true);
  assert.doesNotMatch(body.result.response.text, /£299/);
});
