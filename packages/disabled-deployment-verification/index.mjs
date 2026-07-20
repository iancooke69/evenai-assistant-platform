const FULL_SHA = /^[0-9a-f]{40}$/i;
const EXPECTED_ROUTE = "getgascert.com/api/assistant/*";
const EXPECTED_ZONE = "getgascert.com";
const EXPECTED_SERVICE = "evenai-ggc-assistant";

const REQUIRED_CHECKS = Object.freeze([
  "deployment-evidence",
  "cloudflare-deployment",
  "release-config-disabled",
  "release-route-configured",
  "live-binding-disabled",
  "live-origins-empty",
  "live-route-disabled-response",
  "cors-not-exposed",
]);

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

function requireDeploymentEvidence(evidence, releaseCommit, deploymentRunId) {
  if (!evidence || typeof evidence !== "object") {
    throw new TypeError("disabled deployment evidence is required");
  }
  if (evidence.schemaVersion !== 1 || evidence.decision !== "disabled-worker-deployment-authorized") {
    throw new Error("valid disabled deployment evidence is required");
  }
  if (evidence.deploymentStatus !== "deployed-disabled") {
    throw new Error("deployment evidence does not record a completed disabled deployment");
  }
  if (fullSha(evidence.releaseCommit, "evidence.releaseCommit") !== releaseCommit) {
    throw new Error("deployment evidence does not match the requested release");
  }
  if (positiveRunId(evidence.workflowRunId, "evidence.workflowRunId") !== deploymentRunId) {
    throw new Error("deployment evidence does not match the requested workflow run");
  }
  const controls = evidence.controls ?? {};
  if (
    controls.publicAssistantEnabled !== false
    || controls.workersDevDisabled !== true
    || controls.publicActivationProhibited !== true
    || controls.postDeploymentVerificationRequired !== true
  ) {
    throw new Error("deployment evidence does not preserve the disabled control posture");
  }
}

function activeVersionId(deployments) {
  if (deployments?.success !== true) return null;
  const records = deployments?.result?.deployments;
  if (!Array.isArray(records) || records.length === 0) return null;
  const versions = records[0]?.versions;
  if (!Array.isArray(versions) || versions.length !== 1 || Number(versions[0]?.percentage) !== 100) return null;
  const id = String(versions[0]?.version_id ?? "").trim();
  return id || null;
}

function versionBinding(versionDetails, expectedVersionId, name) {
  if (versionDetails?.success !== true) return null;
  if (String(versionDetails?.result?.id ?? "").trim() !== expectedVersionId) return null;
  const bindings = versionDetails?.result?.resources?.bindings;
  if (!Array.isArray(bindings)) return null;
  return bindings.find((candidate) => candidate?.name === name && candidate?.type === "plain_text") ?? null;
}

function sourceConfigDisabled(config) {
  return config?.workers_dev === false
    && config?.vars?.ENABLE_PUBLIC_ASSISTANT === "false"
    && String(config?.vars?.ALLOWED_ORIGINS ?? "").trim() === "";
}

function sourceRouteConfigured(config) {
  const routes = Array.isArray(config?.routes) ? config.routes : [];
  return routes.some((route) => (
    route?.pattern === EXPECTED_ROUTE
    && route?.zone_name === EXPECTED_ZONE
  ));
}

function liveRouteIsDisabledWorker(probe) {
  return probe?.status === 503
    && probe?.assistantResponse !== true
    && probe?.service === EXPECTED_SERVICE
    && probe?.error === "assistant_unavailable";
}

export function verifyDisabledDeployment(input = {}) {
  const releaseCommit = fullSha(input.releaseCommit, "releaseCommit");
  const deploymentRunId = positiveRunId(input.deploymentRunId, "deploymentRunId");
  requireDeploymentEvidence(input.deploymentEvidence, releaseCommit, deploymentRunId);

  const deployedVersionId = activeVersionId(input.cloudflareDeployments);
  const publicBinding = deployedVersionId
    ? versionBinding(input.cloudflareVersionDetails, deployedVersionId, "ENABLE_PUBLIC_ASSISTANT")
    : null;
  const originsBinding = deployedVersionId
    ? versionBinding(input.cloudflareVersionDetails, deployedVersionId, "ALLOWED_ORIGINS")
    : null;

  const checks = Object.freeze({
    "deployment-evidence": "pass",
    "cloudflare-deployment": deployedVersionId ? "pass" : "fail",
    "release-config-disabled": sourceConfigDisabled(input.releaseConfig) ? "pass" : "fail",
    "release-route-configured": sourceRouteConfigured(input.releaseConfig) ? "pass" : "fail",
    "live-binding-disabled": publicBinding?.text === "false" ? "pass" : "fail",
    "live-origins-empty": originsBinding && String(originsBinding.text ?? "").trim() === "" ? "pass" : "fail",
    "live-route-disabled-response": liveRouteIsDisabledWorker(input.probe) ? "pass" : "fail",
    "cors-not-exposed": input.probe?.corsOrigin == null ? "pass" : "fail",
  });

  const failedChecks = Object.freeze(REQUIRED_CHECKS.filter((name) => checks[name] !== "pass"));
  const verified = failedChecks.length === 0;

  return Object.freeze({
    schemaVersion: 1,
    decision: verified ? "retain-disabled-deployment" : "disable-and-rollback",
    verified,
    releaseCommit,
    deploymentRunId,
    observedAt: new Date().toISOString(),
    checks,
    failedChecks,
    controls: Object.freeze({
      publicAssistantEnabled: false,
      workersDevDisabled: true,
      canaryActivationAuthorized: false,
      publicActivationProhibited: true,
    }),
  });
}
