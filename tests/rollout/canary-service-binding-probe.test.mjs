import assert from "node:assert/strict";
import test from "node:test";
import { createServiceBindingProbeDefinition } from "../../scripts/execute-canary-activation.mjs";

const canaryVersionId = "22222222-2222-4222-8222-222222222222";

test("builds a private temporary Worker that targets the exact assistant version", () => {
  const definition = createServiceBindingProbeDefinition({
    probeName: "evenai-ggc-canary-probe-400",
    canaryVersionId,
    probeToken: "private-probe-token",
    compatibilityDate: "2026-07-20",
  });

  assert.equal(definition.config.name, "evenai-ggc-canary-probe-400");
  assert.equal(definition.config.workers_dev, true);
  assert.equal(definition.config.preview_urls, false);
  assert.deepEqual(definition.config.services, [{
    binding: "ASSISTANT",
    service: "evenai-ggc-assistant",
  }]);
  assert.equal(definition.config.vars.TARGET_VERSION_ID, canaryVersionId);
  assert.equal(definition.config.vars.PROBE_TOKEN, "private-probe-token");
  assert.match(definition.source, /x-evenai-probe-token/);
  assert.match(definition.source, /Cloudflare-Workers-Version-Overrides/);
  assert.match(definition.source, /env\.ASSISTANT\.fetch/);
  assert.match(definition.source, /Can you help\?/);
});
