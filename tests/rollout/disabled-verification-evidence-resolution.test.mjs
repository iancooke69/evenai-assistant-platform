import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  findLatestDisabledVerificationRun,
  readVerifiedDisabledDeployment,
} from "../../scripts/resolve-disabled-verification-evidence.mjs";

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return payload; },
    async text() { return JSON.stringify(payload); },
  };
}

test("selects the newest successful verification run with retained evidence", async () => {
  const fetchImpl = async (url) => {
    if (url.includes("/actions/workflows/")) {
      return jsonResponse({
        workflow_runs: [
          { id: 400, conclusion: "success" },
          { id: 300, conclusion: "success" },
        ],
      });
    }
    if (url.includes("/actions/runs/400/artifacts")) {
      return jsonResponse({ artifacts: [{ id: 41, name: "other", expired: false }] });
    }
    if (url.includes("/actions/runs/300/artifacts")) {
      return jsonResponse({
        artifacts: [{ id: 31, name: "disabled-deployment-verification-evidence", expired: false }],
      });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  const result = await findLatestDisabledVerificationRun({
    fetchImpl,
    repository: "owner/repo",
    token: "token",
  });

  assert.deepEqual(result, { verificationRunId: "300", artifactId: "31" });
});

test("fails closed when verification artifacts are expired", async () => {
  const fetchImpl = async (url) => {
    if (url.includes("/actions/workflows/")) {
      return jsonResponse({ workflow_runs: [{ id: 200, conclusion: "success" }] });
    }
    return jsonResponse({
      artifacts: [{ id: 21, name: "disabled-deployment-verification-evidence", expired: true }],
    });
  };

  await assert.rejects(
    findLatestDisabledVerificationRun({ fetchImpl, repository: "owner/repo", token: "token" }),
    /No successful verify-disabled-deployment\.yml run/,
  );
});

test("reads passing verification evidence for the latest deployment", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "disabled-verification-"));
  const evidencePath = path.join(directory, "disabled-deployment-verification-evidence.json");
  const releaseCommit = "a".repeat(40);
  fs.writeFileSync(evidencePath, JSON.stringify({
    schemaVersion: 1,
    decision: "retain-disabled-deployment",
    verified: true,
    releaseCommit,
    deploymentRunId: "123",
  }));

  const result = readVerifiedDisabledDeployment(evidencePath, "123");
  assert.equal(result.releaseCommit, releaseCommit);
  assert.equal(result.deploymentRunId, "123");
  assert.equal(result.evidence.verified, true);
});

test("rejects stale or failed verification evidence", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "disabled-verification-"));
  const evidencePath = path.join(directory, "disabled-deployment-verification-evidence.json");
  fs.writeFileSync(evidencePath, JSON.stringify({
    schemaVersion: 1,
    decision: "retain-disabled-deployment",
    verified: true,
    releaseCommit: "a".repeat(40),
    deploymentRunId: "100",
  }));

  assert.throws(
    () => readVerifiedDisabledDeployment(evidencePath, "101"),
    /not for the latest deployment run/,
  );

  fs.writeFileSync(evidencePath, JSON.stringify({
    schemaVersion: 1,
    decision: "disable-and-rollback",
    verified: false,
    releaseCommit: "a".repeat(40),
    deploymentRunId: "101",
  }));
  assert.throws(
    () => readVerifiedDisabledDeployment(evidencePath, "101"),
    /not passing disabled deployment verification evidence/,
  );
});
