import test from "node:test";
import assert from "node:assert/strict";
import { createCanaryActivationAuthorization } from "../../packages/canary-activation-authorization/index.mjs";

const releaseCommit = "a".repeat(40);
const deploymentRunId = "12345";

function passingVerification() {
  return {
    schemaVersion: 1,
    decision: "retain-disabled-deployment",
    verified: true,
    releaseCommit,
    deploymentRunId,
    checks: {
      "deployment-evidence": "pass",
      "cloudflare-deployment": "pass",
      "release-config-disabled": "pass",
      "live-binding-disabled": "pass",
      "live-origins-empty": "pass",
      "route-not-serving-assistant": "pass",
      "cors-not-exposed": "pass",
    },
    failedChecks: [],
    controls: {
      publicAssistantEnabled: false,
      workersDevDisabled: true,
      canaryActivationAuthorized: false,
      publicActivationProhibited: true,
    },
  };
}

test("authorizes only a tightly bounded canary", () => {
  const result = createCanaryActivationAuthorization({
    verificationEvidence: passingVerification(),
    verificationRunId: "67890",
    latestDeploymentRunId: deploymentRunId,
    authorizationRunId: "98765",
  });

  assert.equal(result.decision, "canary-activation-authorized");
  assert.equal(result.activationStatus, "not-activated");
  assert.equal(result.limits.maximumExposurePercent, 5);
  assert.equal(result.limits.minimumObservationMinutes, 30);
  assert.equal(result.limits.maximumRequestsPerMinutePerClient, 10);
  assert.equal(result.controls.canaryActivationMayBePerformed, true);
  assert.equal(result.controls.fullPublicActivationAuthorized, false);
  assert.equal(result.controls.automaticPromotionProhibited, true);
  assert.equal(result.failureAction, "disable-and-rollback");
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.limits), true);
});

test("rejects failed, incomplete or permissive verification evidence", () => {
  assert.throws(() => createCanaryActivationAuthorization({
    verificationEvidence: { ...passingVerification(), verified: false },
    verificationRunId: "67890",
    latestDeploymentRunId: deploymentRunId,
    authorizationRunId: "98765",
  }), /passing disabled deployment verification/);

  const failedCheck = passingVerification();
  failedCheck.checks["live-binding-disabled"] = "fail";
  assert.throws(() => createCanaryActivationAuthorization({
    verificationEvidence: failedCheck,
    verificationRunId: "67890",
    latestDeploymentRunId: deploymentRunId,
    authorizationRunId: "98765",
  }), /every disabled deployment verification check/);

  const permissive = passingVerification();
  permissive.controls.publicAssistantEnabled = true;
  assert.throws(() => createCanaryActivationAuthorization({
    verificationEvidence: permissive,
    verificationRunId: "67890",
    latestDeploymentRunId: deploymentRunId,
    authorizationRunId: "98765",
  }), /required disabled posture/);
});

test("rejects stale verification from an older deployment", () => {
  assert.throws(() => createCanaryActivationAuthorization({
    verificationEvidence: passingVerification(),
    verificationRunId: "67890",
    latestDeploymentRunId: "99999",
    authorizationRunId: "98765",
  }), /not for the latest disabled deployment/);
});

test("evidence excludes origins, bindings, credentials and response content", () => {
  const verificationEvidence = {
    ...passingVerification(),
    origin: "https://example.invalid",
    secret: "do-not-copy",
    response: "private response text",
    bindings: { token: "private" },
  };
  const result = createCanaryActivationAuthorization({
    verificationEvidence,
    verificationRunId: "67890",
    latestDeploymentRunId: deploymentRunId,
    authorizationRunId: "98765",
  });
  const serialized = JSON.stringify(result);

  assert.doesNotMatch(serialized, /example\.invalid/);
  assert.doesNotMatch(serialized, /do-not-copy|private response|token/);
  assert.equal("verificationEvidence" in result, false);
});

test("rejects malformed workflow identities", () => {
  assert.throws(() => createCanaryActivationAuthorization({
    verificationEvidence: passingVerification(),
    verificationRunId: "#4",
    latestDeploymentRunId: deploymentRunId,
    authorizationRunId: "98765",
  }), /positive GitHub Actions run ID/);
});
