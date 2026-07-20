import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  createOwnerCanaryConfig,
  deployOwnerCanaryTest,
  verifyEnabledCanaryVersion,
} from "../../scripts/manage-owner-canary-test.mjs";

const stableVersionId = "11111111-1111-4111-8111-111111111111";
const canaryVersionId = "22222222-2222-4222-8222-222222222222";
const testTokenHash = "a".repeat(64);

function deployments() {
  return {
    success: true,
    result: {
      deployments: [{
        versions: [
          { version_id: stableVersionId, percentage: 95 },
          { version_id: canaryVersionId, percentage: 5 },
        ],
      }],
    },
  };
}

function enabledVersionDetails(overrides = {}) {
  return {
    success: true,
    result: {
      id: canaryVersionId,
      resources: {
        bindings: [
          { name: "ENABLE_PUBLIC_ASSISTANT", type: "plain_text", text: "true" },
          {
            name: "ALLOWED_ORIGINS",
            type: "plain_text",
            text: "https://getgascert.com,https://www.getgascert.com",
          },
        ],
      },
      ...overrides,
    },
  };
}

test("builds a separate authenticated service-binding gateway without changing rollout traffic", () => {
  const config = createOwnerCanaryConfig({
    targetVersionId: canaryVersionId,
    ownerTokenHash: testTokenHash,
  });

  assert.equal(config.name, "evenai-ggc-owner-canary-test");
  assert.equal(config.workers_dev, true);
  assert.equal(config.preview_urls, false);
  assert.deepEqual(config.services, [{
    binding: "ASSISTANT",
    service: "evenai-ggc-assistant",
  }]);
  assert.equal(config.vars.TARGET_VERSION_ID, canaryVersionId);
  assert.equal(config.vars.OWNER_TOKEN_SHA256, testTokenHash);
  assert.equal("routes" in config, false);
  assert.equal("ratelimits" in config, false);
  assert.doesNotMatch(JSON.stringify(config), /private-owner-token/);
});

test("accepts only an enabled canary with the exact approved origins", () => {
  assert.equal(verifyEnabledCanaryVersion(enabledVersionDetails(), canaryVersionId), true);

  const disabled = enabledVersionDetails();
  disabled.result.resources.bindings[0].text = "false";
  assert.throws(
    () => verifyEnabledCanaryVersion(disabled, canaryVersionId),
    /not enabled/,
  );

  const widenedOrigins = enabledVersionDetails();
  widenedOrigins.result.resources.bindings[1].text += ",https://example.invalid";
  assert.throws(
    () => verifyEnabledCanaryVersion(widenedOrigins, canaryVersionId),
    /exact approved origin set/,
  );
});

test("deploys only after proving the exact live 95/5 canary and pins its 5 percent version", async () => {
  const cloudflareCalls = [];
  let deployedConfig;
  const result = await deployOwnerCanaryTest({
    target: "https://evenai-ggc-owner-canary-test.example.workers.dev",
    attempts: 1,
    delayMs: 0,
    cloudflareImpl: async (pathname) => {
      cloudflareCalls.push(pathname);
      if (pathname.endsWith("/deployments")) return deployments();
      if (pathname.endsWith(`/versions/${canaryVersionId}`)) {
        return enabledVersionDetails();
      }
      throw new Error(`Unexpected Cloudflare path: ${pathname}`);
    },
    deployImpl: async ({ config }) => {
      deployedConfig = config;
    },
    fetchImpl: async () => new Response("ready", {
      status: 200,
      headers: {
        "x-evenai-owner-test-gateway": "evenai-ggc-owner-canary-test",
      },
    }),
  });

  assert.deepEqual(cloudflareCalls, [
    "/workers/scripts/evenai-ggc-assistant/deployments",
    `/workers/scripts/evenai-ggc-assistant/versions/${canaryVersionId}`,
  ]);
  assert.equal(deployedConfig.vars.TARGET_VERSION_ID, canaryVersionId);
  assert.equal(result.canaryVersionId, canaryVersionId);
  assert.equal(
    result.target,
    "https://evenai-ggc-owner-canary-test.example.workers.dev",
  );
});

test("workflow exposes only deploy and remove operations through the protected environment", () => {
  const workflow = fs.readFileSync(
    new URL("../../.github/workflows/manage-owner-canary-test.yml", import.meta.url),
    "utf8",
  );

  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /production-disabled/);
  assert.match(workflow, /manage-owner-canary-test\.mjs --deploy/);
  assert.match(workflow, /manage-owner-canary-test\.mjs --remove/);
  assert.match(workflow, /npm test/);
  assert.doesNotMatch(workflow, /OWNER_TOKEN|TARGET_VERSION_ID/);
  assert.doesNotMatch(workflow, /versions deploy|@100%|@5%|@95%/);
});
