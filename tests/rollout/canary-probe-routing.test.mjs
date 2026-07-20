import assert from "node:assert/strict";
import test from "node:test";
import {
  probeCanaryApplication,
  resolveCanaryProbeRoute,
} from "../../scripts/execute-canary-activation.mjs";

const stableVersionId = "11111111-1111-4111-8111-111111111111";
const canaryVersionId = "22222222-2222-4222-8222-222222222222";

function response({ status, versionId, body = "", corsOrigin = null }) {
  const headers = new Headers({
    "x-evenai-service": "evenai-ggc-assistant",
    "x-evenai-version-id": versionId,
  });
  if (corsOrigin) headers.set("access-control-allow-origin", corsOrigin);
  return new Response(body, { status, headers });
}

test("uses a successful version override without affinity fallback", async () => {
  const requests = [];
  const fetchImpl = async (_url, init) => {
    requests.push(init);
    return response({ status: 204, versionId: canaryVersionId });
  };

  const route = await resolveCanaryProbeRoute({
    fetchImpl,
    sleepImpl: async () => {},
    canaryVersionId,
    activationRunId: "400",
    overrideAttempts: 1,
    affinityAttempts: 2,
    overrideDelayMs: 0,
  });

  assert.equal(route.mode, "version-override");
  assert.equal(
    route.headers["Cloudflare-Workers-Version-Overrides"],
    `evenai-ggc-assistant="${canaryVersionId}"`,
  );
  assert.equal(requests.length, 1);
  assert.equal(requests[0].method, "OPTIONS");
});

test("falls back to a confirmed affinity key when version override is ignored", async () => {
  const requests = [];
  const fetchImpl = async (_url, init) => {
    requests.push(init);
    const headers = init.headers;
    if (headers["Cloudflare-Workers-Version-Overrides"]) {
      return response({ status: 503, versionId: stableVersionId, body: JSON.stringify({ error: "assistant_unavailable" }) });
    }
    const affinityKey = headers["Cloudflare-Workers-Version-Key"];
    if (affinityKey === "canary-probe-400-3") {
      return response({ status: 204, versionId: canaryVersionId });
    }
    return response({ status: 503, versionId: stableVersionId, body: JSON.stringify({ error: "assistant_unavailable" }) });
  };

  const route = await resolveCanaryProbeRoute({
    fetchImpl,
    sleepImpl: async () => {},
    canaryVersionId,
    activationRunId: "400",
    overrideAttempts: 1,
    affinityAttempts: 3,
    overrideDelayMs: 0,
  });

  assert.equal(route.mode, "version-affinity");
  assert.equal(route.headers["Cloudflare-Workers-Version-Key"], "canary-probe-400-3");
  assert.equal(requests.every((request) => request.method === "OPTIONS"), true);
  assert.equal(
    requests.filter((request) => request.headers["Cloudflare-Workers-Version-Key"] === "canary-probe-400-3").length,
    2,
  );
});

test("performs one application probe on the exact routed canary version", async () => {
  const fetchImpl = async (_url, init) => {
    assert.equal(init.method, "POST");
    assert.equal(init.headers["Cloudflare-Workers-Version-Key"], "canary-probe-400-3");
    assert.equal(init.headers.origin, "https://getgascert.com");
    return response({
      status: 200,
      versionId: canaryVersionId,
      corsOrigin: "https://getgascert.com",
      body: JSON.stringify({ result: { answer: "ok" } }),
    });
  };

  const probe = await probeCanaryApplication({
    fetchImpl,
    canaryVersionId,
    routingHeaders: { "Cloudflare-Workers-Version-Key": "canary-probe-400-3" },
  });

  assert.equal(probe.status, 200);
  assert.equal(probe.versionId, canaryVersionId);
  assert.equal(probe.corsOrigin, "https://getgascert.com");
  assert.deepEqual(JSON.parse(probe.body), { result: { answer: "ok" } });
});

test("fails closed when no override or affinity key reaches the canary", async () => {
  const fetchImpl = async () => response({
    status: 503,
    versionId: stableVersionId,
    body: JSON.stringify({ error: "assistant_unavailable" }),
  });

  await assert.rejects(
    resolveCanaryProbeRoute({
      fetchImpl,
      sleepImpl: async () => {},
      canaryVersionId,
      activationRunId: "400",
      overrideAttempts: 1,
      affinityAttempts: 2,
      overrideDelayMs: 0,
    }),
    /unable to route a protected probe to canary version/,
  );
});
