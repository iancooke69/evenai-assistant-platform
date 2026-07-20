import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  validateFullRolloutAuthorization,
  verifyEnabledCanaryVersionDetails,
  verifyFullRolloutDeployment,
  verifyFullRolloutProbe,
} from "../../scripts/promote-ggc-full-rollout.mjs";

const stableVersionId = "11111111-1111-4111-8111-111111111111";
const canaryVersionId = "22222222-2222-4222-8222-222222222222";

function authorization(overrides = {}) {
  return {
    schemaVersion: 1,
    decision: "ggc-full-rollout-authorized",
    authorizedBy: "Ian Cooke",
    targetWorker: "evenai-ggc-assistant",
    requiredStartingAllocation: "95-disabled-5-enabled",
    targetExposurePercent: 100,
    ownerConfirmedNoExpectedPublicTraffic: true,
    rollbackToDisabledStableRequired: true,
    automaticPromotionAuthorized: false,
    rationale: "Owner-authorized live testing before public traffic.",
    ...overrides,
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
          { name: "RATE_LIMITER", type: "ratelimit" },
        ],
      },
      ...overrides,
    },
  };
}

test("requires explicit owner authorization for exactly 100 percent exposure", () => {
  assert.deepEqual(validateFullRolloutAuthorization(authorization()), {
    authorizedBy: "Ian Cooke",
    rationale: "Owner-authorized live testing before public traffic.",
  });
  assert.throws(
    () => validateFullRolloutAuthorization(authorization({ targetExposurePercent: 50 })),
    /incomplete or outside/,
  );
  assert.throws(
    () => validateFullRolloutAuthorization(authorization({ automaticPromotionAuthorized: true })),
    /incomplete or outside/,
  );
});

test("accepts only the exact enabled canary controls", () => {
  assert.equal(verifyEnabledCanaryVersionDetails(enabledVersionDetails(), canaryVersionId), true);

  const disabled = enabledVersionDetails();
  disabled.result.resources.bindings[0].text = "false";
  assert.throws(
    () => verifyEnabledCanaryVersionDetails(disabled, canaryVersionId),
    /not enabled/,
  );

  const widened = enabledVersionDetails();
  widened.result.resources.bindings[1].text += ",https://example.invalid";
  assert.throws(
    () => verifyEnabledCanaryVersionDetails(widened, canaryVersionId),
    /exact approved origin set/,
  );

  const noLimiter = enabledVersionDetails();
  noLimiter.result.resources.bindings = noLimiter.result.resources.bindings.filter(
    (binding) => binding.name !== "RATE_LIMITER",
  );
  assert.throws(
    () => verifyEnabledCanaryVersionDetails(noLimiter, canaryVersionId),
    /required rate limiter/,
  );
});

test("requires the exact canary version at 100 percent", () => {
  assert.equal(verifyFullRolloutDeployment({
    success: true,
    result: {
      deployments: [{ versions: [{ version_id: canaryVersionId, percentage: 100 }] }],
    },
  }, canaryVersionId), true);

  assert.throws(
    () => verifyFullRolloutDeployment({
      success: true,
      result: {
        deployments: [{
          versions: [
            { version_id: stableVersionId, percentage: 5 },
            { version_id: canaryVersionId, percentage: 95 },
          ],
        }],
      },
    }, canaryVersionId),
    /exact enabled canary version at 100 percent/,
  );
});

test("requires a successful public application response from the promoted version", () => {
  const probe = {
    status: 200,
    corsOrigin: "https://getgascert.com",
    service: "evenai-ggc-assistant",
    versionId: canaryVersionId,
    body: JSON.stringify({ result: { response: { text: "A CP42 certificate costs £299." } } }),
  };
  assert.equal(verifyFullRolloutProbe(probe, canaryVersionId), true);
  assert.throws(
    () => verifyFullRolloutProbe({ ...probe, versionId: stableVersionId }, canaryVersionId),
    /exact promoted version/,
  );
});

test("workflow is one-shot, protected and automatically rolls back failed promotion", () => {
  const workflow = fs.readFileSync(
    new URL("../../.github/workflows/promote-ggc-full-rollout.yml", import.meta.url),
    "utf8",
  );
  assert.match(workflow, /paths:\s*\n\s*- deployment-authorizations\/ggc-full-rollout-v1\.json/);
  assert.match(workflow, /environment: production-disabled/);
  assert.match(workflow, /promote-ggc-full-rollout\.mjs --promote/);
  assert.match(workflow, /promote-ggc-full-rollout\.mjs --rollback/);
  assert.match(workflow, /hashFiles\('full-rollout-plan\.json'\)/);
  assert.match(workflow, /GITHUB_STEP_SUMMARY: ""/);
});
