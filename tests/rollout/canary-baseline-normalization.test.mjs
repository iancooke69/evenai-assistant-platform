import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  classifyCanaryBaseline,
  normalizeCanaryBaseline,
} from "../../scripts/normalize-canary-baseline.mjs";

const stableVersionId = "11111111-1111-4111-8111-111111111111";
const canaryVersionId = "22222222-2222-4222-8222-222222222222";

function deployments(versions) {
  return {
    success: true,
    result: {
      deployments: [{ id: "deployment-1", versions }],
    },
  };
}

function versionDetails(versionId = stableVersionId) {
  return {
    success: true,
    result: {
      id: versionId,
      resources: {
        bindings: [
          { name: "ENABLE_PUBLIC_ASSISTANT", type: "plain_text", text: "false" },
          { name: "ALLOWED_ORIGINS", type: "plain_text", text: "" },
        ],
      },
    },
  };
}

function disabledConfigFile() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "evenai-canary-baseline-"));
  const configPath = path.join(directory, "wrangler.jsonc");
  fs.writeFileSync(configPath, JSON.stringify({
    name: "evenai-ggc-assistant",
    workers_dev: false,
    vars: {
      ENABLE_PUBLIC_ASSISTANT: "false",
      ALLOWED_ORIGINS: "",
    },
  }));
  return { directory, configPath };
}

test("accepts an existing disabled 100 percent baseline without recovery", () => {
  const result = classifyCanaryBaseline(deployments([
    { version_id: stableVersionId, percentage: 100 },
  ]));
  assert.deepEqual(result, {
    stableVersionId,
    canaryVersionId: null,
    recoveryRequired: false,
  });
});

test("classifies only an exact 95/5 split as recoverable", () => {
  const result = classifyCanaryBaseline(deployments([
    { version_id: stableVersionId, percentage: 95 },
    { version_id: canaryVersionId, percentage: 5 },
  ]));
  assert.deepEqual(result, {
    stableVersionId,
    canaryVersionId,
    recoveryRequired: true,
  });

  assert.throws(() => classifyCanaryBaseline(deployments([
    { version_id: stableVersionId, percentage: 90 },
    { version_id: canaryVersionId, percentage: 10 },
  ])), /exact recoverable 95\/5 split/);
});

test("restores a verified disabled stable version before replacement activation", async (t) => {
  const { directory, configPath } = disabledConfigFile();
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  let deploymentReads = 0;
  const calls = [];
  const result = await normalizeCanaryBaseline({
    releaseCommit: "a".repeat(40),
    activationRunId: "400",
    configPath,
    materializeReleaseImpl: () => {},
    sleepImpl: async () => {},
    cloudflareImpl: async (apiPath) => {
      calls.push(apiPath);
      if (apiPath === "/deployments") {
        deploymentReads += 1;
        return deploymentReads === 1
          ? deployments([
            { version_id: stableVersionId, percentage: 95 },
            { version_id: canaryVersionId, percentage: 5 },
          ])
          : deployments([{ version_id: stableVersionId, percentage: 100 }]);
      }
      return versionDetails(stableVersionId);
    },
    deployStableImpl: async ({ stableVersionId: observed, canaryVersionId: canary }) => {
      assert.equal(observed, stableVersionId);
      assert.equal(canary, canaryVersionId);
    },
  });

  assert.equal(result.stableVersionId, stableVersionId);
  assert.equal(result.recovered, true);
  assert.deepEqual(calls, [
    "/deployments",
    `/versions/${stableVersionId}`,
    "/deployments",
    `/versions/${stableVersionId}`,
  ]);
});

test("fails closed when the 95 percent version is not disabled", async (t) => {
  const { directory, configPath } = disabledConfigFile();
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  const enabledDetails = versionDetails(stableVersionId);
  enabledDetails.result.resources.bindings[0].text = "true";

  await assert.rejects(normalizeCanaryBaseline({
    releaseCommit: "a".repeat(40),
    activationRunId: "400",
    configPath,
    materializeReleaseImpl: () => {},
    cloudflareImpl: async (apiPath) => apiPath === "/deployments"
      ? deployments([
        { version_id: stableVersionId, percentage: 95 },
        { version_id: canaryVersionId, percentage: 5 },
      ])
      : enabledDetails,
    deployStableImpl: async () => {
      throw new Error("must not deploy");
    },
  }), /not in the required disabled posture/);
});
