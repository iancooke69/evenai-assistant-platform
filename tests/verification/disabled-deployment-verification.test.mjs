import test from "node:test";
import assert from "node:assert/strict";
import { verifyDisabledDeployment } from "../../packages/disabled-deployment-verification/index.mjs";

const releaseCommit = "a".repeat(40);
const deploymentRunId = "123456";

function passingInput() {
  return {
    releaseCommit,
    deploymentRunId,
    deploymentEvidence: {
      schemaVersion: 1,
      decision: "disabled-worker-deployment-authorized",
      releaseCommit,
      workflowRunId: deploymentRunId,
      deploymentStatus: "deployed-disabled",
      controls: {
        publicAssistantEnabled: false,
        workersDevDisabled: true,
        publicActivationProhibited: true,
        postDeploymentVerificationRequired: true,
      },
    },
    releaseConfig: {
      workers_dev: false,
      vars: {
        ENABLE_PUBLIC_ASSISTANT: "false",
        ALLOWED_ORIGINS: "",
      },
    },
    cloudflareDeployments: {
      success: true,
      result: [{
        id: "deployment-id",
        versions: [{ version_id: "version-id", percentage: 100 }],
      }],
    },
    cloudflareSettings: {
      success: true,
      result: {
        bindings: [
          { name: "ENABLE_PUBLIC_ASSISTANT", type: "plain_text", text: "false" },
          { name: "ALLOWED_ORIGINS", type: "plain_text", text: "" },
        ],
      },
    },
    probe: {
      status: 503,
      assistantResponse: false,
      corsOrigin: null,
    },
  };
}

test("retains only a verified disabled deployment", () => {
  const result = verifyDisabledDeployment(passingInput());

  assert.equal(result.verified, true);
  assert.equal(result.decision, "retain-disabled-deployment");
  assert.deepEqual(result.failedChecks, []);
  assert.equal(result.controls.canaryActivationAuthorized, false);
  assert.equal(result.controls.publicActivationProhibited, true);
});

test("fails closed when live configuration enables the assistant", () => {
  const input = passingInput();
  input.cloudflareSettings.result.bindings[0].text = "true";
  const result = verifyDisabledDeployment(input);

  assert.equal(result.verified, false);
  assert.equal(result.decision, "disable-and-rollback");
  assert.deepEqual(result.failedChecks, ["live-binding-disabled"]);
});

test("fails when the route serves an assistant response or exposes CORS", () => {
  const input = passingInput();
  input.probe = {
    status: 200,
    assistantResponse: true,
    corsOrigin: "https://example.invalid",
  };
  const result = verifyDisabledDeployment(input);

  assert.equal(result.verified, false);
  assert.deepEqual(result.failedChecks, ["route-not-serving-assistant", "cors-not-exposed"]);
});

test("requires exact retained deployment evidence", () => {
  assert.throws(() => verifyDisabledDeployment({
    ...passingInput(),
    deploymentEvidence: { ...passingInput().deploymentEvidence, releaseCommit: "b".repeat(40) },
  }), /does not match the requested release/);

  assert.throws(() => verifyDisabledDeployment({
    ...passingInput(),
    deploymentEvidence: { ...passingInput().deploymentEvidence, workflowRunId: "999" },
  }), /does not match the requested workflow run/);
});

test("output excludes live URLs, bindings and probe content", () => {
  const input = passingInput();
  input.productionUrl = "https://example.invalid/private";
  input.secret = "do-not-copy";
  const result = verifyDisabledDeployment(input);
  const serialized = JSON.stringify(result);

  assert.doesNotMatch(serialized, /example\.invalid/);
  assert.doesNotMatch(serialized, /do-not-copy/);
  assert.equal("cloudflareSettings" in result, false);
  assert.equal("probe" in result, false);
});
