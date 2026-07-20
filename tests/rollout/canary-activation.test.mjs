import test from "node:test";
import assert from "node:assert/strict";
import {
  APPROVED_ORIGINS,
  createCanaryActivationEvidence,
  createCanaryRollbackEvidence,
  locateCanaryVersion,
  prepareCanaryActivation,
  validateCanaryAuthorization,
  verifyCanaryDeployment,
  verifyCanaryProbe,
} from "../../packages/canary-activation/index.mjs";

const releaseCommit = "a".repeat(40);
const stableVersionId = "11111111-1111-4111-8111-111111111111";
const canaryVersionId = "22222222-2222-4222-8222-222222222222";

function authorization() {
  return {
    schemaVersion: 1,
    decision: "canary-activation-authorized",
    activationStatus: "not-activated",
    releaseCommit,
    deploymentRunId: "100",
    verificationRunId: "200",
    authorizationRunId: "300",
    limits: {
      maximumExposurePercent: 5,
      minimumObservationMinutes: 30,
      maximumRequestsPerMinutePerClient: 10,
    },
    controls: {
      publicAssistantCurrentlyEnabled: false,
      canaryActivationMayBePerformed: true,
      fullPublicActivationAuthorized: false,
      automaticPromotionProhibited: true,
      approvedOriginsRequired: true,
      rateLimiterRequired: true,
      telemetryRequired: true,
      postActivationVerificationRequired: true,
      rollbackRequiredOnAnyFailure: true,
    },
  };
}

function disabledDeployments() {
  return {
    success: true,
    result: {
      deployments: [{ id: "deployment-1", versions: [{ version_id: stableVersionId, percentage: 100 }] }],
    },
  };
}

function disabledSettings() {
  return {
    success: true,
    result: {
      bindings: [
        { name: "ENABLE_PUBLIC_ASSISTANT", type: "plain_text", text: "false" },
        { name: "ALLOWED_ORIGINS", type: "plain_text", text: "" },
      ],
    },
  };
}

test("prepares an exact bounded canary configuration from verified disabled state", () => {
  const result = prepareCanaryActivation({
    authorizationEvidence: authorization(),
    latestDeploymentRunId: "100",
    activationRunId: "400",
    cloudflareDeployments: disabledDeployments(),
    cloudflareSettings: disabledSettings(),
    baseConfig: {
      name: "evenai-ggc-assistant",
      main: "apps/ggc/worker.mjs",
      workers_dev: false,
      vars: { ENABLE_PUBLIC_ASSISTANT: "false", ALLOWED_ORIGINS: "" },
    },
  });

  assert.equal(result.releaseCommit, releaseCommit);
  assert.equal(result.stableVersionId, stableVersionId);
  assert.equal(result.canaryTag, "canary-400");
  assert.equal(result.canaryConfig.vars.ENABLE_PUBLIC_ASSISTANT, "true");
  assert.equal(result.canaryConfig.vars.ALLOWED_ORIGINS, APPROVED_ORIGINS.join(","));
  assert.deepEqual(result.canaryConfig.ratelimits[0].simple, { limit: 10, period: 60 });
  assert.equal(result.canaryConfig.observability.enabled, true);
  assert.equal(result.canaryConfig.workers_dev, false);
});

test("rejects stale or widened canary authorization", () => {
  assert.throws(() => validateCanaryAuthorization(authorization(), "999"), /not for the latest/);
  const widened = authorization();
  widened.limits.maximumExposurePercent = 10;
  assert.throws(() => validateCanaryAuthorization(widened, "100"), /outside the approved envelope/);
});

test("requires a single disabled stable version before activation", () => {
  const deployments = disabledDeployments();
  deployments.result.deployments[0].versions = [
    { version_id: stableVersionId, percentage: 95 },
    { version_id: canaryVersionId, percentage: 5 },
  ];
  assert.throws(() => prepareCanaryActivation({
    authorizationEvidence: authorization(),
    latestDeploymentRunId: "100",
    activationRunId: "400",
    cloudflareDeployments: deployments,
    cloudflareSettings: disabledSettings(),
    baseConfig: { workers_dev: false, vars: { ENABLE_PUBLIC_ASSISTANT: "false" } },
  }), /one currently deployed disabled version/);
});

test("locates a uniquely tagged uploaded Worker version", () => {
  const found = locateCanaryVersion([
    { id: stableVersionId, annotations: { "workers/tag": "stable" } },
    { id: canaryVersionId, annotations: { "workers/tag": "canary-400" } },
  ], "canary-400");
  assert.equal(found, canaryVersionId);
});

test("verifies only the exact 95/5 deployment split", () => {
  const deployment = {
    success: true,
    result: {
      deployments: [{
        id: "deployment-2",
        versions: [
          { version_id: stableVersionId, percentage: 95 },
          { version_id: canaryVersionId, percentage: 5 },
        ],
      }],
    },
  };
  assert.equal(verifyCanaryDeployment(deployment, stableVersionId, canaryVersionId), true);
  deployment.result.deployments[0].versions[1].percentage = 6;
  assert.throws(() => verifyCanaryDeployment(deployment, stableVersionId, canaryVersionId), /fixed at 5/);
});

test("targeted probe must show enabled origin-protected behavior", () => {
  assert.equal(verifyCanaryProbe({ status: 404, corsOrigin: APPROVED_ORIGINS[0], body: "not found" }), true);
  assert.throws(() => verifyCanaryProbe({
    status: 503,
    corsOrigin: null,
    body: JSON.stringify({ error: "assistant_unavailable" }),
  }), /did not reach an enabled/);
});

test("activation and rollback evidence never authorize full public release", () => {
  const cloudflareDeployments = {
    success: true,
    result: {
      deployments: [{
        id: "deployment-2",
        versions: [
          { version_id: stableVersionId, percentage: 95 },
          { version_id: canaryVersionId, percentage: 5 },
        ],
      }],
    },
  };
  const evidence = createCanaryActivationEvidence({
    releaseCommit,
    deploymentRunId: "100",
    authorizationRunId: "300",
    activationRunId: "400",
    stableVersionId,
    canaryVersionId,
    cloudflareDeployments,
    probe: { status: 404, corsOrigin: APPROVED_ORIGINS[0], body: "not found" },
  });
  assert.equal(evidence.exposure.canaryPercent, 5);
  assert.equal(evidence.observation.automaticPromotion, false);
  assert.equal(evidence.controls.fullPublicActivationAuthorized, false);

  const rollback = createCanaryRollbackEvidence({ activationRunId: "400", stableVersionId });
  assert.equal(rollback.restoredStablePercent, 100);
  assert.equal(rollback.publicActivationAuthorized, false);
});
