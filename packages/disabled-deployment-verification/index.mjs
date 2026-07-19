const FULL_SHA = /^[0-9a-f]{40}$/i;

const REQUIRED_CHECKS = Object.freeze([
  "deployment-evidence",
  "cloudflare-deployment",
  "release-config-disabled",
  "live-binding-disabled",
  "live-origins-empty",
  "route-not-serving-assistant",
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

function binding(settings, name) {
  if (settings?.success !== true) return null;
  const bindings = settings?.result?.bindings;
  if (!Array.isArray(bindings)) return null;
  return bindings.find((candidate) => candidate?.name === name && candidate?.type === "plain_text") ?? null;
}

function cloudflareDeploymentPresent(deployments) {
  if (deployments?.success !== true) return false;
  const records = deployments?.result?.deployments;
  if (!Array.isArray(records) || records.length === 0) return false;
  return records.some((record) => (
    typeof record?.id === "string"
    && Array.isArray(record?.versions)
    && record.versions.some((version) => typeof version?.version_id === "string" && Number(version?.percentage) > 0)
  ));
}

function sourceConfigDisabled(config) {
  return config?.workers_dev === false
    && config?.vars?.ENABLE_PUBLIC_ASSISTANT === "false"
    && String(config?.vars?.ALLOWED_ORIGINS ?? "").trim() === "";
}

function routeNotServingAssistant(probe) {
  return Number.isInteger(probe?.status)
    && probe.status >= 100
    && probe.status <= 599
    && probe.assistantResponse !== true;
}

export function verifyDisabledDeployment(input = {}) {
  const releaseCommit = fullSha(input.releaseCommit, "releaseCommit");
  const deploymentRunId = positiveRunId(input.deploymentRunId, "deploymentRunId");
  requireDeploymentEvidence(input.deploymentEvidence, releaseCommit, deploymentRunId);

  const publicBinding = binding(input.cloudflareSettings, "ENABLE_PUBLIC_ASSISTANT");
  const originsBinding = binding(input.cloudflareSettings, "ALLOWED_ORIGINS");

  const checks = Object.freeze({
    "deployment-evidence": "pass",
    "cloudflare-deployment": cloudflareDeploymentPresent(input.cloudflareDeployments) ? "pass" : "fail",
    "release-config-disabled": sourceConfigDisabled(input.releaseConfig) ? "pass" : "fail",
    "live-binding-disabled": publicBinding?.text === "false" ? "pass" : "fail",
    "live-origins-empty": originsBinding && String(originsBinding.text ?? "").trim() === "" ? "pass" : "fail",
    "route-not-serving-assistant": routeNotServingAssistant(input.probe) ? "pass" : "fail",
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
