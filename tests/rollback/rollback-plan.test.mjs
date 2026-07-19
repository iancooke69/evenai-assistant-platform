import assert from "node:assert/strict";
import test from "node:test";
import { createRollbackPlan } from "../../packages/rollback-plan/index.mjs";

const manifest = Object.freeze({
  releaseCommit: "1".repeat(40),
  rollbackCommit: "2".repeat(40),
  publicAssistantEnabled: true,
  workersDevDisabled: true,
});

test("creates a deterministic fail-safe rollback sequence", () => {
  const plan = createRollbackPlan(manifest);

  assert.equal(plan.version, 1);
  assert.equal(plan.releaseCommit, manifest.releaseCommit);
  assert.equal(plan.rollbackCommit, manifest.rollbackCommit);
  assert.deepEqual(plan.steps.map((step) => step.action), [
    "disable-public-assistant",
    "restore-rollback-commit",
    "verify-health-endpoint",
    "verify-assistant-remains-disabled",
    "record-incident-outcome",
  ]);
  assert.equal(Object.isFrozen(plan), true);
  assert.equal(Object.isFrozen(plan.steps), true);
});

test("rejects missing, abbreviated and identical commit identities", () => {
  assert.throws(() => createRollbackPlan(), /release manifest is required/i);
  assert.throws(() => createRollbackPlan({ ...manifest, releaseCommit: "abc123" }), /full lowercase SHA-1/i);
  assert.throws(() => createRollbackPlan({ ...manifest, rollbackCommit: manifest.releaseCommit }), /must be different/i);
});

test("rejects manifests without required production controls", () => {
  assert.throws(() => createRollbackPlan({ ...manifest, publicAssistantEnabled: false }), /production controls/i);
  assert.throws(() => createRollbackPlan({ ...manifest, workersDevDisabled: false }), /production controls/i);
});

test("does not expose origins, bindings, secrets or customer data", () => {
  const plan = createRollbackPlan({
    ...manifest,
    allowedOrigins: ["https://www.getgascert.com"],
    secret: "do-not-copy",
    customer: { email: "customer@example.com" },
  });
  const serialized = JSON.stringify(plan);

  assert.doesNotMatch(serialized, /getgascert/i);
  assert.doesNotMatch(serialized, /do-not-copy/i);
  assert.doesNotMatch(serialized, /customer@example/i);
});
