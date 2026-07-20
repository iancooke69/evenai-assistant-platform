import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { findLatestCanaryAuthorizationRun } from "../../scripts/resolve-canary-authorization-evidence.mjs";

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return payload; },
    async text() { return JSON.stringify(payload); },
  };
}

test("authorization workflow automatically follows successful disabled verification", () => {
  const workflow = fs.readFileSync(
    new URL("../../.github/workflows/authorize-canary-activation.yml", import.meta.url),
    "utf8",
  );

  assert.match(workflow, /workflow_run:/);
  assert.match(workflow, /Verify disabled Worker deployment/);
  assert.match(workflow, /workflow_run\.conclusion == 'success'/);
  assert.match(workflow, /TRIGGER_VERIFICATION_RUN_ID/);
  assert.match(workflow, /run-id: \$\{\{ steps\.verification\.outputs\.verification_run_id \}\}/);
});

test("activation discovery accepts automatic and manual authorization runs", async () => {
  const requested = [];
  const fetchImpl = async (url) => {
    requested.push(url);
    if (url.includes("/actions/workflows/authorize-canary-activation.yml/runs")) {
      return jsonResponse({ workflow_runs: [{ id: 123456, conclusion: "success", event: "workflow_run" }] });
    }
    if (url.includes("/actions/runs/123456/artifacts")) {
      return jsonResponse({
        artifacts: [{
          id: 654321,
          name: "canary-activation-authorization",
          expired: false,
        }],
      });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  const result = await findLatestCanaryAuthorizationRun({
    fetchImpl,
    repository: "owner/repo",
    token: "token",
  });

  assert.deepEqual(result, { authorizationRunId: "123456", artifactId: "654321" });
  assert.equal(requested[0].includes("event=workflow_dispatch"), false);
  assert.equal(requested[0].includes("status=success"), true);
  assert.equal(requested[0].includes("branch=main"), true);
});
