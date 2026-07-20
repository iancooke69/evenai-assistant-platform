import test from "node:test";
import assert from "node:assert/strict";
import {
  activationBaseline,
  APPROVED_ORIGINS,
  createCanaryActivationEvidence,
  createCanaryRollbackEvidence,
  currentStableVersionId,
  locateCanaryVersion,
  prepareCanaryActivation,
  validateCanaryAuthorization,
  verifyCanaryDeployment,
  verifyCanaryProbe,
  verifyDisabledVersionDetails,
} from "../../packages/canary-activation/index.mjs";

const releaseCommit = "a".repeat(40);
const stableVersionId = "11111111-1111-4111-8111-111111111111";
const canaryVersionId = "22222222-2222-4222-8222-222222222222";
const successfulProbe = {
  status: 200,
  corsOrigin: "https://getgascert.com",
  body: JSON.stringify({ result: { answer: "ok" } }),
};

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

function boundedCanaryDeployments() {
  return {
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
}

function disabledStableVersionDetails() {
  return {
    success: true,
    result: {
      id: stableVersionId,
      resources: {
        bindings: [
          { name: "ENABLE_PUBLIC_ASSISTANT", type: "plain_text", text: "false" },
          { name: "ALLOWED_ORIGINS", type: "plain_text", text: "" },
        ],
      },
    },
  };
}

function baseConfig() {
  return {
    name: "evenai-ggc-assistant",
    main: "apps/ggc/worker.mjs",
    workers_dev: false,
    vars: { ENABLE_PUBLIC_ASSISTANT: "false", ALLOWED_ORIGINS: "" },
  };
}

test("prepares an exact bounded canary configuration from the deployed disabled version", () => {
  const result = prepareCanaryActivation({
    authorizationEvidence: authorization(),
    latestDeploymentRunId: "100",
    activationRunId: "400",
    cloudflareDeployments: disabledDeployments(),
    stableVersionDetails: disabledStableVersionDetails(),
    baseConfig: baseConfig(),
    cloudflareSettings: {
      success: true,
      result: {
        bindings: [
          { name: "ENABLE_PUBLIC_ASSISTANT", type: "plain_text", text: "true" },
          { name: "ALLOWED_ORIGINS", type: "plain_text", text: APPROVED_ORIGINS.join(",") },
        ],
      },
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

test("uses the active deployment to identify the stable version", () => {
  assert.equal(currentStableVersionId(disabledDeployments()), stableVersionId);
  assert.throws(() => currentStableVersionId(boundedCanaryDeployments()), /one currently deployed disabled version/);
});

test("recognizes only an exact existing 95/5 canary as recoverable", () => {
  assert.deepEqual(activationBaseline(disabledDeployments()), {
    mode: "disabled",
    stableVersionId,
    canaryVersionId: null,
  });
  assert.deepEqual(activationBaseline(boundedCanaryDeployments()), {
    mode: "bounded-canary",
    stableVersionId,
    canaryVersionId,
  });

  const widened = boundedCanaryDeployments();
  widened.result.deployments[0].versions[0].percentage = 90;
  widened.result.deployments[0].versions[1].percentage = 10;
  assert.throws(() => activationBaseline(widened), /exact recoverable 95\/5 bounded canary/);
});

test("requires exact disabled bindings on the deployed stable version", () => {
  assert.equal(verifyDisabledVersionDetails(disabledStableVersionDetails(), stableVersionId), true);

  const enabled = disabledStableVersionDetails();
  enabled.result.resources.bindings[0].text = "true";
  assert.throws(() => verifyDisabledVersionDetails(enabled, stableVersionId), /not in the required disabled posture/);

  const mismatched = disabledStableVersionDetails();
  mismatched.result.id = canaryVersionId;
  assert.throws(() => verifyDisabledVersionDetails(mismatched, stableVersionId), /do not match the deployed stable version/);
});

test("rejects stale or widened canary authorization", () => {
  assert.throws(() => validateCanaryAuthorization(authorization(), "999"), /not for the latest/);
  const widened = authorization();
  widened.limits.maximumExposurePercent = 10;
  assert.throws(() => validateCanaryAuthorization(widened, "100"), /outside the approved envelope/);
});

test("requires a single disabled stable version before activation", () => {
  assert.throws(() => prepareCanaryActivation({
    authorizationEvidence: authorization(),
    latestDeploymentRunId: "100",
    activationRunId: "400",
    cloudflareDeployments: boundedCanaryDeployments(),
    stableVersionDetails: disabledStableVersionDetails(),
    baseConfig: baseConfig(),
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
  const deployment = boundedCanaryDeployments();
  assert.equal(verifyCanaryDeployment(deployment, stableVersionId, canaryVersionId), true);
  deployment.result.deployments[0].versions[1].percentage = 6;
  assert.throws(() => verifyCanaryDeployment(deployment, stableVersionId, canaryVersionId), /fixed at 5/);
});

test("targeted probe must return a successful assistant response", () => {
  assert.equal(verifyCanaryProbe(successfulProbe), true);
  assert.throws(() => verifyCanaryProbe({
    status: 503,
    corsOrigin: null,
    body: JSON.stringify({ error: "assistant_unavailable" }),
  }), /did not return HTTP 200/);
  assert.throws(() => verifyCanaryProbe({
    status: 200,
    corsOrigin: APPROVED_ORIGINS[0],
    body: JSON.stringify({ error: "assistant-failure" }),
  }), /did not return an assistant result/);
});

test("activation and rollback evidence never authorize full public release", () => {
  const evidence = createCanaryActivationEvidence({
    releaseCommit,
    deploymentRunId: "100",
    authorizationRunId: "300",
    activationRunId: "400",
    stableVersionId,
    canaryVersionId,
    cloudflareDeployments: boundedCanaryDeployments(),
    probe: successfulProbe,
  });
  assert.equal(evidence.exposure.canaryPercent, 5);
  assert.equal(evidence.observation.automaticPromotion, false);
  assert.equal(evidence.controls.fullPublicActivationAuthorized, false);

  const rollback = createCanaryRollbackEvidence({
    activationRunId: "400",
    stableVersionId,
    disabledVersionBindingsVerified: true,
  });
  assert.equal(rollback.restoredStablePercent, 100);
  assert.equal(rollback.disabledVersionBindingsVerified, true);
  assert.equal(rollback.publicActivationAuthorized, false);
});
