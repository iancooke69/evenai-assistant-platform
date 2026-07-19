import test from "node:test";
import assert from "node:assert/strict";
import { createCanaryRolloutPlan } from "../../packages/canary-rollout-policy/index.mjs";

const releaseCommit = "a".repeat(40);
const passingVerification = {
  releaseCommit,
  decision: "retain-release",
  checks: {
    health: "pass",
    "approved-origin": "pass",
    "knowledge-response": "pass",
    "emergency-precedence": "pass",
    "rate-limiting": "pass",
    telemetry: "pass",
  },
};

test("creates a two-stage canary rollout", () => {
  const plan = createCanaryRolloutPlan({
    releaseCommit,
    verification: passingVerification,
    canaryPercent: 10,
    observationMinutes: 30,
  });

  assert.deepEqual(plan.stages, [10, 100]);
  assert.equal(plan.failureAction, "disable-and-rollback");
  assert.equal(plan.promotionRule, "all-required-checks-pass");
});

test("permits an explicitly verified full rollout", () => {
  const plan = createCanaryRolloutPlan({
    releaseCommit,
    verification: passingVerification,
    canaryPercent: 100,
    observationMinutes: 15,
  });

  assert.deepEqual(plan.stages, [100]);
});

test("rejects failed or mismatched verification evidence", () => {
  assert.throws(() => createCanaryRolloutPlan({
    releaseCommit,
    verification: { ...passingVerification, decision: "disable-and-rollback" },
    canaryPercent: 10,
    observationMinutes: 30,
  }));

  assert.throws(() => createCanaryRolloutPlan({
    releaseCommit,
    verification: { ...passingVerification, releaseCommit: "b".repeat(40) },
    canaryPercent: 10,
    observationMinutes: 30,
  }));
});

test("rejects missing checks and invalid rollout controls", () => {
  const failedChecks = {
    ...passingVerification,
    checks: { ...passingVerification.checks, telemetry: "fail" },
  };

  assert.throws(() => createCanaryRolloutPlan({
    releaseCommit,
    verification: failedChecks,
    canaryPercent: 10,
    observationMinutes: 30,
  }));

  assert.throws(() => createCanaryRolloutPlan({
    releaseCommit,
    verification: passingVerification,
    canaryPercent: 0,
    observationMinutes: 30,
  }));

  assert.throws(() => createCanaryRolloutPlan({
    releaseCommit: "abc123",
    verification: passingVerification,
    canaryPercent: 10,
    observationMinutes: 30,
  }));
});

test("does not expose verification details or infrastructure data", () => {
  const plan = createCanaryRolloutPlan({
    releaseCommit,
    verification: {
      ...passingVerification,
      origin: "https://example.invalid",
      secret: "do-not-copy",
    },
    canaryPercent: 5,
    observationMinutes: 60,
  });

  assert.equal("origin" in plan, false);
  assert.equal("secret" in plan, false);
  assert.equal("checks" in plan, false);
});
