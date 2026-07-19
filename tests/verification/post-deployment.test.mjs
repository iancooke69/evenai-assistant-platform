import assert from "node:assert/strict";
import test from "node:test";
import { verifyPostDeployment } from "../../packages/post-deployment-verification/index.mjs";

const releaseCommit = "a".repeat(40);
const observedAt = "2026-07-19T12:40:00.000Z";
const passingChecks = {
  health: true,
  "approved-origin": true,
  "knowledge-response": true,
  "emergency-precedence": true,
  "rate-limit": true,
  telemetry: true,
};

test("verification passes only when every production check passes", () => {
  const result = verifyPostDeployment({ releaseCommit, observedAt, checks: passingChecks });

  assert.equal(result.verified, true);
  assert.equal(result.action, "retain-release");
  assert.deepEqual(result.failedChecks, []);
});

test("any missing or failed check requires disablement and rollback", () => {
  const result = verifyPostDeployment({
    releaseCommit,
    observedAt,
    checks: { ...passingChecks, "emergency-precedence": false, telemetry: undefined },
  });

  assert.equal(result.verified, false);
  assert.equal(result.action, "disable-and-rollback");
  assert.deepEqual(result.failedChecks, ["emergency-precedence", "telemetry"]);
});

test("release identity and observation time must be explicit", () => {
  assert.throws(() => verifyPostDeployment({ releaseCommit: "abc", observedAt, checks: passingChecks }), /releaseCommit/);
  assert.throws(() => verifyPostDeployment({ releaseCommit, observedAt: "yesterday", checks: passingChecks }), /observedAt/);
});

test("output excludes probe content and infrastructure details", () => {
  const result = verifyPostDeployment({
    releaseCommit,
    observedAt,
    checks: passingChecks,
    origin: "https://www.getgascert.com",
    message: "How much is a CP42?",
    bindings: { secret: "not-for-output" },
  });

  assert.equal("origin" in result, false);
  assert.equal("message" in result, false);
  assert.equal("bindings" in result, false);
});
