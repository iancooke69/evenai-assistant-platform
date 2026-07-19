import test from "node:test";
import assert from "node:assert/strict";
import { createManualReleaseGate } from "../../packages/manual-release-gate/index.mjs";

const input = {
  releaseCommit: "a".repeat(40),
  rollbackCommit: "b".repeat(40),
  route: "assistant.getgascert.com/*",
  privacyNoticeUrl: "https://www.getgascert.com/privacy",
  allowedOrigins: "https://www.getgascert.com,https://getgascert.com",
};

test("creates privacy-safe disabled-deployment release evidence", () => {
  const result = createManualReleaseGate(input);

  assert.equal(result.decision, "release-authorized-for-disabled-deployment");
  assert.equal(result.releaseCommit, input.releaseCommit);
  assert.equal(result.rollbackCommit, input.rollbackCommit);
  assert.equal(result.originCount, 2);
  assert.equal(result.controls.deploymentRemainsDisabled, true);
  assert.equal(result.controls.publicActivationProhibited, true);
  assert.equal(result.controls.postDeploymentVerificationRequired, true);
  assert.equal(result.controls.canaryRolloutRequired, true);
  assert.equal("route" in result, false);
  assert.equal("privacyNoticeUrl" in result, false);
  assert.equal("allowedOrigins" in result, false);
  assert.equal(Object.isFrozen(result), true);
});

test("rejects incomplete or unsafe release inputs", () => {
  assert.throws(() => createManualReleaseGate({ ...input, releaseCommit: "short" }));
  assert.throws(() => createManualReleaseGate({ ...input, rollbackCommit: input.releaseCommit }));
  assert.throws(() => createManualReleaseGate({ ...input, allowedOrigins: "" }));
  assert.throws(() => createManualReleaseGate({ ...input, allowedOrigins: "http://example.com" }));
});
