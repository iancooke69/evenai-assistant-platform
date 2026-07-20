import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  createEnabledRepairConfig,
  currentDisabledDeploymentVersionId,
  validateRepairAuthorization,
  verifyEnabledRepairDeployment,
  verifyEnabledRepairProbe,
  verifyEnabledRepairVersionDetails,
} from "../../scripts/repair-ggc-full-rollout.mjs";

const disabledVersionId = "11111111-1111-4111-8111-111111111111";
const enabledVersionId = "22222222-2222-4222-8222-222222222222";

function authorization(overrides = {}) {
  return {
    schemaVersion: 1,
    decision: "ggc-full-rollout-repair-authorized",
    authorizedBy: "Ian Cooke",
    targetWorker: "evenai-ggc-assistant",
    requiredStartingState: "one-disabled-version-at-100-percent",
    targetExposurePercent: 100,
    rollbackToCurrentDisabledVersionRequired: true,
    automaticPromotionAuthorized: false,
    rationale: "Repair the confirmed disabled public deployment.",
    ...overrides,
  };
}

function baseConfig() {
  return {
    name: "evenai-ggc-assistant",
    main: "apps/ggc/worker.mjs",
    compatibility_date: "2026-07-19",
    workers_dev: false,
    routes: [{
      pattern: "getgascert.com/api/assistant/*",
      zone_name: "getgascert.com",
    }],
    version_metadata: { binding: "CF_VERSION_METADATA" },
    vars: {
      ENABLE_PUBLIC_ASSISTANT: "false",
      ALLOWED_ORIGINS: "",
      RATE_LIMIT_RETRY_AFTER_SECONDS: "60",
    },
  };
}

function enabledVersionDetails(overrides = {}) {
  return {
    success: true,
    result: {
      id: enabledVersionId,
      resources: {
        bindings: [
          { name: "ENABLE_PUBLIC_ASSISTANT", type: "plain_text", text: "true" },
          {
            name: "ALLOWED_ORIGINS",
            type: "plain_text",
            text: "https://getgascert.com,https://www.getgascert.com",
          },
          { name: "RATE_LIMITER", type: "ratelimit" },
          { name: "CF_VERSION_METADATA", type: "version_metadata" },
        ],
      },
      ...overrides,
    },
  };
}

test("requires explicit owner authorization for the fail-closed repair", () => {
  assert.deepEqual(validateRepairAuthorization(authorization()), {
    authorizedBy: "Ian Cooke",
    rationale: "Repair the confirmed disabled public deployment.",
  });
  assert.throws(
    () => validateRepairAuthorization(authorization({ requiredStartingState: "any" })),
    /incomplete or outside/,
  );
  assert.throws(
    () => validateRepairAuthorization(authorization({ automaticPromotionAuthorized: true })),
    /incomplete or outside/,
  );
});

test("accepts only one current version at 100 percent as the disabled rollback baseline", () => {
  assert.equal(currentDisabledDeploymentVersionId({
    success: true,
    result: {
      deployments: [{ versions: [{ version_id: disabledVersionId, percentage: 100 }] }],
    },
  }), disabledVersionId);
  assert.throws(
    () => currentDisabledDeploymentVersionId({
      success: true,
      result: {
        deployments: [{
          versions: [
            { version_id: disabledVersionId, percentage: 95 },
            { version_id: enabledVersionId, percentage: 5 },
          ],
        }],
      },
    }),
    /exactly one currently deployed version/,
  );
});

test("generates a fully enabled production config without mutating the disabled baseline", () => {
  const disabled = baseConfig();
  const enabled = createEnabledRepairConfig(disabled);

  assert.equal(disabled.vars.ENABLE_PUBLIC_ASSISTANT, "false");
  assert.equal(enabled.vars.ENABLE_PUBLIC_ASSISTANT, "true");
  assert.equal(
    enabled.vars.ALLOWED_ORIGINS,
    "https://getgascert.com,https://www.getgascert.com",
  );
  assert.equal(enabled.workers_dev, false);
  assert.equal(enabled.preview_urls, false);
  assert.deepEqual(enabled.routes, [{
    pattern: "getgascert.com/api/assistant/*",
    zone_name: "getgascert.com",
  }]);
  assert.deepEqual(enabled.ratelimits, [{
    name: "RATE_LIMITER",
    namespace_id: "26071901",
    simple: { limit: 10, period: 60 },
  }]);
  assert.deepEqual(enabled.observability, { enabled: true, head_sampling_rate: 1 });
  assert.deepEqual(enabled.version_metadata, { binding: "CF_VERSION_METADATA" });
});

test("requires exact enabled bindings before and after traffic changes", () => {
  assert.equal(
    verifyEnabledRepairVersionDetails(enabledVersionDetails(), enabledVersionId),
    true,
  );

  const disabled = enabledVersionDetails();
  disabled.result.resources.bindings[0].text = "false";
  assert.throws(
    () => verifyEnabledRepairVersionDetails(disabled, enabledVersionId),
    /not enabled/,
  );

  const widened = enabledVersionDetails();
  widened.result.resources.bindings[1].text += ",https://example.invalid";
  assert.throws(
    () => verifyEnabledRepairVersionDetails(widened, enabledVersionId),
    /exact approved origin set/,
  );

  const noLimiter = enabledVersionDetails();
  noLimiter.result.resources.bindings = noLimiter.result.resources.bindings.filter(
    (binding) => binding.name !== "RATE_LIMITER",
  );
  assert.throws(
    () => verifyEnabledRepairVersionDetails(noLimiter, enabledVersionId),
    /required rate limiter/,
  );
});

test("requires the newly uploaded enabled version at exactly 100 percent", () => {
  assert.equal(verifyEnabledRepairDeployment({
    success: true,
    result: {
      deployments: [{ versions: [{ version_id: enabledVersionId, percentage: 100 }] }],
    },
  }, enabledVersionId), true);
  assert.throws(
    () => verifyEnabledRepairDeployment({
      success: true,
      result: {
        deployments: [{ versions: [{ version_id: disabledVersionId, percentage: 100 }] }],
      },
    }, enabledVersionId),
    /exact newly uploaded enabled version/,
  );
});

test("requires a successful public response from the exact repaired version", () => {
  const probe = {
    status: 200,
    corsOrigin: "https://getgascert.com",
    service: "evenai-ggc-assistant",
    versionId: enabledVersionId,
    body: JSON.stringify({ result: { response: { text: "A CP42 certificate costs £299." } } }),
  };
  assert.equal(verifyEnabledRepairProbe(probe, enabledVersionId), true);
  assert.throws(
    () => verifyEnabledRepairProbe({ ...probe, versionId: disabledVersionId }, enabledVersionId),
    /exact newly uploaded enabled version/,
  );
});

test("repair uploads and deploys with the generated enabled config and rolls back with the disabled config", () => {
  const source = fs.readFileSync(
    new URL("../../scripts/repair-ggc-full-rollout.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /"versions", "upload",\s*\n\s*"--config", ENABLED_CONFIG_PATH/);
  assert.match(source, /`${enabledVersionId}@100%`,\s*\n\s*"--config", ENABLED_CONFIG_PATH/);
  assert.match(source, /`${disabledVersionId}@100%`,\s*\n\s*"--config", BASE_CONFIG_PATH/);
});

test("workflow is one-shot, protected and automatically restores the disabled version on failure", () => {
  const workflow = fs.readFileSync(
    new URL("../../.github/workflows/repair-ggc-full-rollout.yml", import.meta.url),
    "utf8",
  );
  assert.match(workflow, /paths:\s*\n\s*- deployment-authorizations\/ggc-full-rollout-repair-v1\.json/);
  assert.match(workflow, /environment: production-disabled/);
  assert.match(workflow, /repair-ggc-full-rollout\.mjs --repair/);
  assert.match(workflow, /repair-ggc-full-rollout\.mjs --rollback/);
  assert.match(workflow, /hashFiles\('full-rollout-repair-plan\.json'\)/);
  assert.match(workflow, /GITHUB_STEP_SUMMARY: ""/);
});
