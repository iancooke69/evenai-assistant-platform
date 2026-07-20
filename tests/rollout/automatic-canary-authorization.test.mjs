import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const activationWorkflowUrl = new URL("../../.github/workflows/activate-canary.yml", import.meta.url);

test("operator runs one protected workflow after disabled verification", () => {
  const workflow = fs.readFileSync(activationWorkflowUrl, "utf8");

  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /Discover latest passing disabled verification/);
  assert.match(workflow, /Create in-run bounded canary authorization/);
  assert.match(workflow, /Execute protected canary activation/);
  assert.doesNotMatch(workflow, /authorize-canary-activation\.yml/);
  assert.doesNotMatch(workflow, /canary-activation-authorization\n\s+path: authorization-evidence/);
});
