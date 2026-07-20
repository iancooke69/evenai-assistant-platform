import test from "node:test";
import assert from "node:assert/strict";
import { verifyDisabledDeployment } from "../../packages/disabled-deployment-verification/index.mjs";

const releaseCommit = "a".repeat(40);
const deploymentRunId = "123456";
const activeVersionId = "11111111-1111-4111-8111-111111111111";

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
      routes: [{ pattern: "getgascert.com/api/assistant/*", zone_name: "getgascert.com" }],
      vars: {
        ENABLE_PUBLIC_ASSISTANT: "false",
        ALLOWED_ORIGINS: "",
      },
    },
    cloudflareDeployments: {
      success: true,
      result: {
        deployments: [{
          id: "deployment-id",
          versions: [{ version_id: activeVersionId, percentage: 100 }],
        }],
      },
    },
    cloudflareVersionDetails: {
      success: true,
      result: {
        id: activeVersionId,
        resources: {
          bindings: [
            { name: "ENABLE_PUBLIC_ASSISTANT", type: "plain_text", text: "false" },
            { name: "ALLOWED_ORIGINS", type: "plain_text", text: "" },
          ],
        },
      },
    },
    probe: {
      status: 503,
      assistantResponse: false,
      corsOrigin: null,
      service: "evenai-ggc-assistant",
      error: "assistant_unavailable",
    },
  };
}

test("retains only a verified disabled deployment on the exact live route", () => {
  const result = verifyDisabledDeployment(passingInput());

  assert.equal(result.verified, true);
  assert.equal(result.decision, "retain-disabled-deployment");
  assert.deepEqual(result.failedChecks, []);
  assert.equal(result.controls.canaryActivationAuthorized, false);
  assert.equal(result.controls.publicActivationProhibited, true);
});

test("fails closed when the production route is absent", () => {
  const input = passingInput();
  input.releaseConfig.routes = [];
  const result = verifyDisabledDeployment(input);

  assert.equal(result.verified, false);
  assert.deepEqual(result.failedChecks, ["release-route-configured"]);
});

test("fails closed when the production URL does not reach this Worker", () => {
  const input = passingInput();
  input.probe = {
    status: 404,
    assistantResponse: false,
    corsOrigin: null,
    service: null,
    error: null,
  };
  const result = verifyDisabledDeployment(input);

  assert.equal(result.verified, false);
  assert.deepEqual(result.failedChecks, ["live-route-disabled-response"]);
});

test("fails closed when the active deployment is not exactly one version at 100 percent", () => {
  const input = passingInput();
  input.cloudflareDeployments.result.deployments[0].versions = [
    { version_id: activeVersionId, percentage: 95 },
    { version_id: "22222222-2222-4222-8222-222222222222", percentage: 5 },
  ];
  const result = verifyDisabledDeployment(input);

  assert.equal(result.verified, false);
  assert.deepEqual(result.failedChecks, ["cloudflare-deployment", "live-binding-disabled", "live-origins-empty"]);
});

test("fails closed when the actively deployed version enables the assistant", () => {
  const input = passingInput();
  input.cloudflareVersionDetails.result.resources.bindings[0].text = "true";
  const result = verifyDisabledDeployment(input);

  assert.equal(result.verified, false);
  assert.equal(result.decision, "disable-and-rollback");
  assert.deepEqual(result.failedChecks, ["live-binding-disabled"]);
});

test("ignores settings belonging to a non-deployed uploaded version", () => {
  const input = passingInput();
  input.cloudflareSettings = {
    success: true,
    result: {
      bindings: [
        { name: "ENABLE_PUBLIC_ASSISTANT", type: "plain_text", text: "true" },
        { name: "ALLOWED_ORIGINS", type: "plain_text", text: "https://getgascert.com" },
      ],
    },
  };
  const result = verifyDisabledDeployment(input);

  assert.equal(result.verified, true);
  assert.deepEqual(result.failedChecks, []);
});

test("fails when version details do not match the active deployment", () => {
  const input = passingInput();
  input.cloudflareVersionDetails.result.id = "22222222-2222-4222-8222-222222222222";
  const result = verifyDisabledDeployment(input);

  assert.equal(result.verified, false);
  assert.deepEqual(result.failedChecks, ["live-binding-disabled", "live-origins-empty"]);
});

test("fails when the route serves an assistant response or exposes CORS", () => {
  const input = passingInput();
  input.probe = {
    status: 200,
    assistantResponse: true,
    corsOrigin: "https://example.invalid",
    service: "evenai-ggc-assistant",
    error: null,
  };
  const result = verifyDisabledDeployment(input);

  assert.equal(result.verified, false);
  assert.deepEqual(result.failedChecks, ["live-route-disabled-response", "cors-not-exposed"]);
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
  assert.equal("cloudflareVersionDetails" in result, false);
  assert.equal("probe" in result, false);
});
