const FULL_SHA = /^[0-9a-f]{40}$/i;

const REQUIRED_DISABLED_CHECKS = Object.freeze([
  "deployment-evidence",
  "cloudflare-deployment",
  "release-config-disabled",
  "release-route-configured",
  "live-binding-disabled",
  "live-origins-empty",
  "live-route-disabled-response",
  "cors-not-exposed",
]);

const LIMITS = Object.freeze({
  maximumExposurePercent: 5,
  minimumObservationMinutes: 30,
  maximumRequestsPerMinutePerClient: 10,
});

function fullSha(value, name) {
  if (typeof value !== "string" || !FULL_SHA.test(value.trim())) {
    throw new TypeError(`${name} must be a full 40-character commit SHA`);
  }
  return value.trim().toLowerCase();
}

function positiveRunId(value, name) {
  const normalized = String(value ?? "").trim();
  if (!/^[1-9][0-9]*$/.test(normalized)) {
    throw new TypeError(`${name} must be a positive GitHub Actions run ID`);
  }
  return normalized;
}

function requireVerifiedDisabledDeployment(evidence, latestDeploymentRunId) {
  if (!evidence || typeof evidence !== "object") {
    throw new TypeError("disabled deployment verification evidence is required");
  }

  if (
    evidence.schemaVersion !== 1
    || evidence.decision !== "retain-disabled-deployment"
    || evidence.verified !== true
  ) {
    throw new Error("a passing disabled deployment verification is required");
  }

  if (!Array.isArray(evidence.failedChecks) || evidence.failedChecks.length !== 0) {
    throw new Error("disabled deployment verification must have no failed checks");
  }

  const checks = evidence.checks ?? {};
  if (REQUIRED_DISABLED_CHECKS.some((name) => checks[name] !== "pass")) {
    throw new Error("every disabled deployment verification check must pass");
  }

  const controls = evidence.controls ?? {};
  if (
    controls.publicAssistantEnabled !== false
    || controls.workersDevDisabled !== true
    || controls.canaryActivationAuthorized !== false
    || controls.publicActivationProhibited !== true
  ) {
    throw new Error("verification evidence does not preserve the required disabled posture");
  }

  const deploymentRunId = positiveRunId(evidence.deploymentRunId, "evidence.deploymentRunId");
  if (deploymentRunId !== latestDeploymentRunId) {
    throw new Error("verification evidence is not for the latest disabled deployment");
  }

  return Object.freeze({
    releaseCommit: fullSha(evidence.releaseCommit, "evidence.releaseCommit"),
    deploymentRunId,
  });
}

export function createCanaryActivationAuthorization(input = {}) {
  const verificationRunId = positiveRunId(input.verificationRunId, "verificationRunId");
  const latestDeploymentRunId = positiveRunId(input.latestDeploymentRunId, "latestDeploymentRunId");
  const authorizationRunId = positiveRunId(input.authorizationRunId, "authorizationRunId");
  const verified = requireVerifiedDisabledDeployment(input.verificationEvidence, latestDeploymentRunId);

  return Object.freeze({
    schemaVersion: 1,
    decision: "canary-activation-authorized",
    generatedAt: new Date().toISOString(),
    releaseCommit: verified.releaseCommit,
    deploymentRunId: verified.deploymentRunId,
    verificationRunId,
    authorizationRunId,
    service: "evenai-ggc-assistant",
    environment: "production",
    activationStatus: "not-activated",
    limits: LIMITS,
    failureAction: "disable-and-rollback",
    controls: Object.freeze({
      publicAssistantCurrentlyEnabled: false,
      canaryActivationMayBePerformed: true,
      fullPublicActivationAuthorized: false,
      automaticPromotionProhibited: true,
      approvedOriginsRequired: true,
      rateLimiterRequired: true,
      telemetryRequired: true,
      postActivationVerificationRequired: true,
      rollbackRequiredOnAnyFailure: true,
      dedicatedActivationWorkflowRequired: true,
    }),
  });
}
