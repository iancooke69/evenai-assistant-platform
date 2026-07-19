import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  findLatestDisabledDeploymentRun,
  readExactDeploymentEvidence,
} from "../../scripts/resolve-disabled-deployment-evidence.mjs";

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return payload; },
    async text() { return JSON.stringify(payload); },
  };
}

test("selects the newest successful deployment run with retained evidence", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.includes("/actions/workflows/")) {
      return jsonResponse({
        workflow_runs: [
          { id: 300, conclusion: "success" },
          { id: 200, conclusion: "success" },
        ],
      });
    }
    if (url.includes("/actions/runs/300/artifacts")) {
      return jsonResponse({ artifacts: [{ id: 31, name: "other", expired: false }] });
    }
    if (url.includes("/actions/runs/200/artifacts")) {
      return jsonResponse({
        artifacts: [{ id: 21, name: "disabled-worker-deployment-evidence", expired: false }],
      });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  const result = await findLatestDisabledDeploymentRun({
    fetchImpl,
    repository: "owner/repo",
    token: "token",
  });

  assert.deepEqual(result, { deploymentRunId: "200", artifactId: "21" });
  assert.equal(calls.some((url) => url.includes("branch=main")), true);
});

test("skips expired deployment evidence", async () => {
  const fetchImpl = async (url) => {
    if (url.includes("/actions/workflows/")) {
      return jsonResponse({ workflow_runs: [{ id: 100, conclusion: "success" }] });
    }
    return jsonResponse({
      artifacts: [{ id: 11, name: "disabled-worker-deployment-evidence", expired: true }],
    });
  };

  await assert.rejects(
    findLatestDisabledDeploymentRun({ fetchImpl, repository: "owner/repo", token: "token" }),
    /No successful deploy-disabled-worker\.yml run/,
  );
});

test("reads exact deployment evidence and derives the release commit", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "disabled-evidence-"));
  const evidencePath = path.join(directory, "disabled-deployment-evidence.json");
  const releaseCommit = "a".repeat(40);
  fs.writeFileSync(evidencePath, JSON.stringify({
    schemaVersion: 1,
    decision: "disabled-worker-deployment-authorized",
    deploymentStatus: "deployed-disabled",
    workflowRunId: "123",
    releaseCommit,
  }));

  const result = readExactDeploymentEvidence(evidencePath, "123");
  assert.deepEqual(result, { releaseCommit, deploymentRunId: "123" });
});

test("rejects evidence from a different workflow run", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "disabled-evidence-"));
  const evidencePath = path.join(directory, "disabled-deployment-evidence.json");
  fs.writeFileSync(evidencePath, JSON.stringify({
    schemaVersion: 1,
    decision: "disabled-worker-deployment-authorized",
    deploymentStatus: "deployed-disabled",
    workflowRunId: "999",
    releaseCommit: "a".repeat(40),
  }));

  assert.throws(
    () => readExactDeploymentEvidence(evidencePath, "123"),
    /does not match its workflow run/,
  );
});
