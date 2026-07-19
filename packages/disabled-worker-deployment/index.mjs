const FULL_SHA = /^[0-9a-f]{40}$/i;

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

export function authorizeDisabledWorkerDeployment(input = {}) {
  const releaseCommit = fullSha(input.releaseCommit, "releaseCommit");
  const gateRunId = positiveRunId(input.gateRunId, "gateRunId");
  const evidence = input.releaseGateEvidence ?? {};

  if (evidence.schemaVersion !== 1 || evidence.decision !== "release-authorized-for-disabled-deployment") {
    throw new Error("valid manual release-gate evidence is required");
  }

  if (fullSha(evidence.releaseCommit, "evidence.releaseCommit") !== releaseCommit) {
    throw new Error("release-gate evidence does not match the requested release");
  }

  if (evidence.controls?.deploymentRemainsDisabled !== true || evidence.controls?.publicActivationProhibited !== true) {
    throw new Error("release-gate evidence does not require a disabled deployment");
  }

  return Object.freeze({
    schemaVersion: 1,
    decision: "disabled-worker-deployment-authorized",
    releaseCommit,
    gateRunId,
    service: "evenai-ggc-assistant",
    environment: "production",
    controls: Object.freeze({
      publicAssistantEnabled: false,
      workersDevDisabled: true,
      publicActivationProhibited: true,
      postDeploymentVerificationRequired: true,
      canaryRolloutRequired: true,
    }),
  });
}

export function createDisabledDeploymentEvidence(input = {}) {
  const authorization = authorizeDisabledWorkerDeployment(input);
  return Object.freeze({
    ...authorization,
    generatedAt: new Date().toISOString(),
    workflowRunId: positiveRunId(input.workflowRunId, "workflowRunId"),
    deploymentStatus: "deployed-disabled",
  });
}
