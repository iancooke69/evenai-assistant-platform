import test from "node:test";
import assert from "node:assert/strict";
import { verifyDisabledDeployment } from "../../packages/disabled-deployment-verification/index.mjs";
import { createCanaryActivationAuthorization } from "../../packages/canary-activation-authorization/index.mjs";

const releaseCommit = "a".repeat(40);
const deploymentRunId = "123456";
const activeVersionId = "11111111-1111-4111-8111-111111111111";

function verifiedDisabledDeployment() {
  return verifyDisabledDeployment({
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
  });
}

test("current disabled verification evidence authorizes the bounded canary", () => {
  const verificationEvidence = verifiedDisabledDeployment();
  assert.equal(verificationEvidence.verified, true);

  const authorization = createCanaryActivationAuthorization({
    verificationEvidence,
    verificationRunId: "234567",
    latestDeploymentRunId: deploymentRunId,
    authorizationRunId: "345678",
  });

  assert.equal(authorization.decision, "canary-activation-authorized");
  assert.equal(authorization.deploymentRunId, deploymentRunId);
  assert.equal(authorization.releaseCommit, releaseCommit);
});
