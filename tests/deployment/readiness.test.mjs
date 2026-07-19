import assert from "node:assert/strict";
import test from "node:test";
import { assessDeploymentReadiness } from "../../packages/deployment-readiness/index.mjs";

function completeInput() {
  return {
    env: {
      ENABLE_PUBLIC_ASSISTANT: "true",
      ALLOWED_ORIGINS: "https://www.getgascert.com,https://getgascert.com",
      RATE_LIMITER: { limit: async () => ({ success: true }) },
      TELEMETRY: { write: async () => undefined },
    },
    deployment: {
      workersDev: false,
      route: "assistant.getgascert.com/*",
      privacyNoticeUrl: "https://www.getgascert.com/privacy",
      rollbackCommit: "0123456789abcdef",
    },
  };
}

test("reports every missing production prerequisite", () => {
  const result = assessDeploymentReadiness();
  assert.equal(result.ready, false);
  assert.deepEqual(result.blockers, [
    "public-assistant-disabled",
    "allowed-origins-empty",
    "rate-limiter-missing",
    "telemetry-missing",
    "workers-dev-not-disabled",
    "public-route-missing",
    "privacy-notice-missing",
    "rollback-commit-missing",
  ]);
});

test("rejects malformed or insecure browser origins", () => {
  const input = completeInput();
  input.env.ALLOWED_ORIGINS = "http://getgascert.com,https://getgascert.com/path";
  const result = assessDeploymentReadiness(input);
  assert.equal(result.ready, false);
  assert.ok(result.blockers.includes("allowed-origin-invalid"));
});

test("passes only when all deployment prerequisites are explicit", () => {
  const result = assessDeploymentReadiness(completeInput());
  assert.equal(result.ready, true);
  assert.deepEqual(result.blockers, []);
  assert.equal(result.originCount, 2);
});

test("does not expose environment values or binding objects", () => {
  const result = assessDeploymentReadiness(completeInput());
  assert.deepEqual(Object.keys(result), ["ready", "blockers", "originCount"]);
  assert.equal(JSON.stringify(result).includes("getgascert.com"), false);
});
