import test from "node:test";
import assert from "node:assert/strict";
import { authorizeDisabledWorkerDeployment, createDisabledDeploymentEvidence } from "../../packages/disabled-worker-deployment/index.mjs";

const releaseCommit = "a".repeat(40);
const gateEvidence = {
  schemaVersion: 1,
  decision: "release-authorized-for-disabled-deployment",
  releaseCommit,
  controls: {
    deploymentRemainsDisabled: true,
    publicActivationProhibited: true,
  },
};

test("authorizes the exact gated release", () => {
  const result = authorizeDisabledWorkerDeployment({ releaseCommit, gateRunId: "12345", releaseGateEvidence: gateEvidence });
  assert.equal(result.releaseCommit, releaseCommit);
  assert.equal(result.controls.publicAssistantEnabled, false);
});

test("rejects mismatched or permissive evidence", () => {
  assert.throws(() => authorizeDisabledWorkerDeployment({
    releaseCommit,
    gateRunId: "12345",
    releaseGateEvidence: { ...gateEvidence, releaseCommit: "b".repeat(40) },
  }));
  assert.throws(() => authorizeDisabledWorkerDeployment({
    releaseCommit,
    gateRunId: "12345",
    releaseGateEvidence: { ...gateEvidence, controls: { ...gateEvidence.controls, deploymentRemainsDisabled: false } },
  }));
});

test("creates minimal deployment evidence", () => {
  const evidence = createDisabledDeploymentEvidence({
    releaseCommit,
    gateRunId: "12345",
    workflowRunId: "67890",
    releaseGateEvidence: gateEvidence,
  });
  assert.equal(evidence.deploymentStatus, "deployed-disabled");
  assert.equal("releaseGateEvidence" in evidence, false);
});

test("rejects malformed identities", () => {
  assert.throws(() => authorizeDisabledWorkerDeployment({ releaseCommit: "abc", gateRunId: "12345", releaseGateEvidence: gateEvidence }));
  assert.throws(() => authorizeDisabledWorkerDeployment({ releaseCommit, gateRunId: "0", releaseGateEvidence: gateEvidence }));
});
