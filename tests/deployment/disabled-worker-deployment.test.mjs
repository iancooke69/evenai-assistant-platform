import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { authorizeDisabledWorkerDeployment, createDisabledDeploymentEvidence } from "../../packages/disabled-worker-deployment/index.mjs";
import {
  normalizeReleaseCommit,
  normalizeReleaseGateRunId,
} from "../../scripts/disabled-worker-deployment.mjs";

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

test("normalizes plain and labelled release commit input", () => {
  assert.equal(normalizeReleaseCommit(releaseCommit), releaseCommit);
  assert.equal(normalizeReleaseCommit(`Release commit: ${releaseCommit}`), releaseCommit);
  assert.equal(normalizeReleaseCommit(`  ${releaseCommit.toUpperCase()}  `), releaseCommit);
});

test("rejects ambiguous or incomplete release commit input", () => {
  assert.throws(() => normalizeReleaseCommit("abc"), /exactly one full 40-character/);
  assert.throws(
    () => normalizeReleaseCommit(`${releaseCommit} ${"b".repeat(40)}`),
    /exactly one full 40-character/,
  );
});

test("normalizes numeric and URL release-gate run IDs", () => {
  assert.equal(normalizeReleaseGateRunId("29728963977"), "29728963977");
  assert.equal(normalizeReleaseGateRunId("Release gate run ID: 29728963977"), "29728963977");
  assert.equal(
    normalizeReleaseGateRunId("https://github.com/iancooke69/evenai-assistant-platform/actions/runs/29728963977"),
    "29728963977",
  );
});

test("rejects visible workflow numbers and ambiguous run IDs", () => {
  assert.throws(() => normalizeReleaseGateRunId("#6"), /not the visible workflow number/);
  assert.throws(() => normalizeReleaseGateRunId("123 456"), /exactly one numeric GitHub Actions run ID/);
});

test("workflow never passes raw release input to checkout", () => {
  const workflow = fs.readFileSync(
    new URL("../../.github/workflows/deploy-disabled-worker.yml", import.meta.url),
    "utf8",
  );
  assert.match(workflow, /Normalize and validate deployment inputs/);
  assert.match(workflow, /ref: \$\{\{ steps\.inputs\.outputs\.release_commit \}\}/);
  assert.doesNotMatch(workflow, /ref: \$\{\{ inputs\.release_commit \}\}/);
});
