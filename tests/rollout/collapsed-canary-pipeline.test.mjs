import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createCanaryActivationAuthorization } from "../../packages/canary-activation-authorization/index.mjs";
import { validateCanaryAuthorization } from "../../packages/canary-activation/index.mjs";

const activationWorkflowUrl = new URL("../../.github/workflows/activate-canary.yml", import.meta.url);
const separateAuthorizationWorkflowUrl = new URL("../../.github/workflows/authorize-canary-activation.yml", import.meta.url);

function passingVerificationEvidence() {
  return {
    schemaVersion: 1,
    decision: "retain-disabled-deployment",
    verified: true,
    releaseCommit: "a".repeat(40),
    deploymentRunId: "123456",
    failedChecks: [],
    checks: {
      "deployment-evidence": "pass",
      "cloudflare-deployment": "pass",
      "release-config-disabled": "pass",
      "release-route-configured": "pass",
      "live-binding-disabled": "pass",
      "live-origins-empty": "pass",
      "live-route-disabled-response": "pass",
      "cors-not-exposed": "pass",
    },
    controls: {
      publicAssistantEnabled: false,
      workersDevDisabled: true,
      canaryActivationAuthorized: false,
      publicActivationProhibited: true,
    },
  };
}

test("activation workflow performs authorization in the same protected run", () => {
  const workflow = fs.readFileSync(activationWorkflowUrl, "utf8");

  assert.match(workflow, /Discover latest passing disabled verification/);
  assert.match(workflow, /Download exact disabled verification evidence/);
  assert.match(workflow, /Create in-run bounded canary authorization/);
  assert.match(workflow, /AUTHORIZATION_RUN_ID: \$\{\{ github\.run_id \}\}/);
  assert.doesNotMatch(workflow, /Discover latest canary authorization/);
  assert.doesNotMatch(workflow, /resolve-canary-authorization-evidence\.mjs/);
  assert.doesNotMatch(workflow, /name: canary-activation-authorization\n\s+path: authorization-evidence/);
});

test("activation workflow uses Node 24 artifact actions", () => {
  const workflow = fs.readFileSync(activationWorkflowUrl, "utf8");

  assert.match(workflow, /actions\/download-artifact@v7/);
  assert.match(workflow, /actions\/upload-artifact@v7/);
  assert.doesNotMatch(workflow, /actions\/(?:download|upload)-artifact@v[45]/);
});

test("separate authorization workflow is removed", () => {
  assert.equal(fs.existsSync(separateAuthorizationWorkflowUrl), false);
});

test("same-run authorization is valid for activation", () => {
  const verificationEvidence = passingVerificationEvidence();
  const authorization = createCanaryActivationAuthorization({
    verificationEvidence,
    verificationRunId: "234567",
    latestDeploymentRunId: "123456",
    authorizationRunId: "345678",
  });

  const validated = validateCanaryAuthorization(authorization, "123456");
  assert.equal(validated.releaseCommit, "a".repeat(40));
  assert.equal(validated.deploymentRunId, "123456");
  assert.equal(validated.authorizationRunId, "345678");
});
