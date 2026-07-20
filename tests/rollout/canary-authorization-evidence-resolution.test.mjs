import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  findLatestCanaryAuthorizationRun,
  readCanaryAuthorization,
} from "../../scripts/resolve-canary-authorization-evidence.mjs";

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return payload; },
    async text() { return JSON.stringify(payload); },
  };
}

function evidence() {
  return {
    schemaVersion: 1,
    decision: "canary-activation-authorized",
    activationStatus: "not-activated",
    releaseCommit: "a".repeat(40),
    deploymentRunId: "100",
    verificationRunId: "200",
    authorizationRunId: "300",
    limits: {
      maximumExposurePercent: 5,
      minimumObservationMinutes: 30,
      maximumRequestsPerMinutePerClient: 10,
    },
    controls: {
      publicAssistantCurrentlyEnabled: false,
      canaryActivationMayBePerformed: true,
      fullPublicActivationAuthorized: false,
      automaticPromotionProhibited: true,
      approvedOriginsRequired: true,
      rateLimiterRequired: true,
      telemetryRequired: true,
      postActivationVerificationRequired: true,
      rollbackRequiredOnAnyFailure: true,
    },
  };
}

test("finds the newest successful authorization with retained evidence", async () => {
  const fetchImpl = async (url) => {
    if (url.includes("/actions/workflows/")) {
      return jsonResponse({ workflow_runs: [
        { id: 400, conclusion: "success" },
        { id: 300, conclusion: "success" },
      ] });
    }
    if (url.includes("/actions/runs/400/artifacts")) {
      return jsonResponse({ artifacts: [{ id: 41, name: "other", expired: false }] });
    }
    return jsonResponse({ artifacts: [{
      id: 31,
      name: "canary-activation-authorization",
      expired: false,
    }] });
  };

  const result = await findLatestCanaryAuthorizationRun({
    fetchImpl,
    repository: "owner/repo",
    token: "token",
  });
  assert.deepEqual(result, { authorizationRunId: "300", artifactId: "31" });
});

test("rejects expired authorization artifacts", async () => {
  const fetchImpl = async (url) => {
    if (url.includes("/actions/workflows/")) {
      return jsonResponse({ workflow_runs: [{ id: 300, conclusion: "success" }] });
    }
    return jsonResponse({ artifacts: [{
      id: 31,
      name: "canary-activation-authorization",
      expired: true,
    }] });
  };
  await assert.rejects(
    findLatestCanaryAuthorizationRun({ fetchImpl, repository: "owner/repo", token: "token" }),
    /No successful authorize-canary-activation\.yml run/,
  );
});

test("validates the artifact against both deployment and authorization runs", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "canary-auth-"));
  const evidencePath = path.join(directory, "canary-activation-authorization.json");
  fs.writeFileSync(evidencePath, JSON.stringify(evidence()));

  const result = readCanaryAuthorization(evidencePath, "100", "300");
  assert.equal(result.releaseCommit, "a".repeat(40));
  assert.equal(result.deploymentRunId, "100");
  assert.equal(result.authorizationRunId, "300");

  assert.throws(() => readCanaryAuthorization(evidencePath, "999", "300"), /not for the latest/);
  assert.throws(() => readCanaryAuthorization(evidencePath, "100", "999"), /does not match its workflow run/);
});
