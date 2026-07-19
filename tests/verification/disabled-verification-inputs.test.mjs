import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeDeploymentRunId,
  normalizeReleaseCommit,
} from "../../scripts/normalize-disabled-verification-inputs.mjs";

const sha = "EA9C5763AFFE526C672120F026886C1A046317D4";

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

test("normalizes a numeric deployment run ID or Actions URL", () => {
  assert.equal(normalizeDeploymentRunId("29696884359"), "29696884359");
  assert.equal(
    normalizeDeploymentRunId("https://github.com/iancooke69/evenai-assistant-platform/actions/runs/29696884359"),
    "29696884359",
  );
});

test("rejects workflow display numbers and ambiguous run URLs", () => {
  assert.throws(() => normalizeDeploymentRunId("#4"), /positive numeric run ID/);
  assert.throws(
    () => normalizeDeploymentRunId("/actions/runs/123 /actions/runs/456"),
    /positive numeric run ID/,
  );
});
