import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeDeploymentRunId,
  normalizeDisabledDeploymentInputs,
  normalizeReleaseCommit,
} from "../../scripts/normalize-disabled-verification-inputs.mjs";

const sha = "EA9C5763AFFE526C672120F026886C1A046317D4";
const runId = "29696884359";

test("normalizes an exact or labelled release SHA", () => {
  assert.equal(normalizeReleaseCommit(sha), sha.toLowerCase());
  assert.equal(
    normalizeReleaseCommit(`Release commit: ${sha}`),
    sha.toLowerCase(),
  );
});

test("rejects missing or ambiguous release SHAs", () => {
  assert.throws(() => normalizeReleaseCommit("ea9c576"), /exactly one full/);
  assert.throws(
    () => normalizeReleaseCommit(`${"a".repeat(40)} ${"b".repeat(40)}`),
    /exactly one full/,
  );
});

test("normalizes numeric, labelled, or URL Actions run IDs", () => {
  assert.equal(normalizeDeploymentRunId(runId), runId);
  assert.equal(normalizeDeploymentRunId(`Release gate run ID: ${runId}`), runId);
  assert.equal(
    normalizeDeploymentRunId(`https://github.com/iancooke69/evenai-assistant-platform/actions/runs/${runId}`),
    runId,
  );
});

test("normalizes the exact disabled deployment workflow inputs", () => {
  assert.deepEqual(normalizeDisabledDeploymentInputs({
    releaseCommit: `Release commit: ${sha}`,
    releaseGateRunId: `Release gate run ID: ${runId}`,
  }), {
    releaseCommit: sha.toLowerCase(),
    releaseGateRunId: runId,
  });
});

test("rejects workflow display numbers and ambiguous run values", () => {
  assert.throws(() => normalizeDeploymentRunId("#4"), /positive numeric run ID/);
  assert.throws(
    () => normalizeDeploymentRunId("/actions/runs/123456 /actions/runs/456789"),
    /exactly one GitHub Actions run ID/,
  );
  assert.throws(
    () => normalizeDeploymentRunId("run 123456 and run 456789"),
    /positive numeric run ID/,
  );
});
