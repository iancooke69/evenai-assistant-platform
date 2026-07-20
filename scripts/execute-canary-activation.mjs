import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import {
  APPROVED_ORIGINS,
  createCanaryActivationEvidence,
  createCanaryRollbackEvidence,
  currentStableVersionId,
  prepareCanaryActivation,
  verifyDisabledVersionDetails,
} from "../packages/canary-activation/index.mjs";
import { parseVersionUploadRecord } from "../packages/wrangler-output/index.mjs";

const WORKER_NAME = "evenai-ggc-assistant";
const PROBE_URL = "https://getgascert.com/api/assistant/v1/assist";
const PLAN_PATH = "canary-plan.json";
const SOURCE_DIR = "release-source";
const DISABLED_CONFIG_PATH = `${SOURCE_DIR}/wrangler.jsonc`;
const CANARY_CONFIG_PATH = `${SOURCE_DIR}/wrangler.canary.jsonc`;
const ACTIVATION_EVIDENCE_PATH = "canary-activation-evidence.json";
const ROLLBACK_EVIDENCE_PATH = "canary-rollback-evidence.json";
const WRANGLER_OUTPUT_PATH = path.resolve("wrangler-version-upload.ndjson");

function required(name) {
  const value = String(process.env[name] ?? "").trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function readJson(filePath, label = filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`Unable to read ${label}: ${error.message}`);
  }
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function run(command, args, environment = {}) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: { ...process.env, ...environment },
    encoding: "utf8",
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed with exit code ${result.status}`);
}

async function cloudflare(apiPath) {
  const accountId = required("CLOUDFLARE_ACCOUNT_ID");
  const token = required("CLOUDFLARE_API_TOKEN");
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${WORKER_NAME}${apiPath}`,
    {
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/json",
      },
    },
  );
  const body = await response.text();
  if (!response.ok) throw new Error(`Cloudflare API ${apiPath} failed (${response.status}): ${body.slice(0, 300)}`);
  try {
    return JSON.parse(body);
  } catch {
    throw new Error(`Cloudflare API ${apiPath} did not return JSON`);
  }
}

function wrangler(args, environment = {}) {
  run("npx", ["--yes", "wrangler@4", ...args], environment);
}

function materializeRelease(releaseCommit) {
  run("git", ["cat-file", "-e", `${releaseCommit}^{commit}`]);
  if (fs.existsSync(SOURCE_DIR)) fs.rmSync(SOURCE_DIR, { recursive: true, force: true });
  run("git", ["worktree", "add", "--detach", SOURCE_DIR, releaseCommit]);
}

async function targetedProbe(canaryVersionId) {
  const response = await fetch(PROBE_URL, {
    method: "POST",
    headers: {
      origin: APPROVED_ORIGINS[0],
      "content-type": "application/json",
      "Cloudflare-Workers-Version-Overrides": `${WORKER_NAME}="${canaryVersionId}"`,
    },
    body: JSON.stringify({ message: "Can you help?" }),
  });
  return {
    status: response.status,
    corsOrigin: response.headers.get("access-control-allow-origin"),
    body: (await response.text()).slice(0, 2000),
  };
}

async function activate() {
  required("CLOUDFLARE_API_TOKEN");
  required("CLOUDFLARE_ACCOUNT_ID");
  const releaseCommit = required("RELEASE_COMMIT");
  const activationRunId = required("ACTIVATION_RUN_ID");
  const latestDeploymentRunId = required("LATEST_DEPLOYMENT_RUN_ID");
  const authorizationPath = required("CANARY_AUTHORIZATION_PATH");

  const deploymentsBefore = await cloudflare("/deployments");
  const stableVersionId = currentStableVersionId(deploymentsBefore);
  const stableVersionDetails = await cloudflare(`/versions/${stableVersionId}`);
  materializeRelease(releaseCommit);

  const prepared = prepareCanaryActivation({
    authorizationEvidence: readJson(authorizationPath, "canary authorization evidence"),
    latestDeploymentRunId,
    activationRunId,
    cloudflareDeployments: deploymentsBefore,
    stableVersionDetails,
    baseConfig: readJson(DISABLED_CONFIG_PATH, "release Wrangler configuration"),
  });

  writeJson(CANARY_CONFIG_PATH, prepared.canaryConfig);
  const plan = {
    schemaVersion: 1,
    releaseCommit: prepared.releaseCommit,
    deploymentRunId: prepared.deploymentRunId,
    authorizationRunId: prepared.authorizationRunId,
    activationRunId: prepared.activationRunId,
    stableVersionId: prepared.stableVersionId,
    canaryTag: prepared.canaryTag,
    canaryVersionId: null,
  };
  writeJson(PLAN_PATH, plan);

  if (fs.existsSync(WRANGLER_OUTPUT_PATH)) fs.rmSync(WRANGLER_OUTPUT_PATH, { force: true });
  wrangler([
    "versions", "upload",
    "--config", CANARY_CONFIG_PATH,
    "--tag", prepared.canaryTag,
    "--message", `Authorized bounded canary run ${activationRunId}`,
  ], {
    WRANGLER_OUTPUT_FILE_PATH: WRANGLER_OUTPUT_PATH,
  });

  const uploadRecord = parseVersionUploadRecord(
    fs.readFileSync(WRANGLER_OUTPUT_PATH, "utf8"),
    WORKER_NAME,
  );
  const canaryVersionId = uploadRecord.versionId;
  plan.canaryVersionId = canaryVersionId;
  writeJson(PLAN_PATH, plan);

  wrangler([
    "versions", "deploy",
    `${prepared.stableVersionId}@95%`,
    `${canaryVersionId}@5%`,
    "--config", CANARY_CONFIG_PATH,
    "--message", `Protected 5 percent canary run ${activationRunId}`,
    "-y",
  ]);

  await new Promise((resolve) => setTimeout(resolve, 5000));
  const deploymentsAfter = await cloudflare("/deployments");
  const probe = await targetedProbe(canaryVersionId);
  const evidence = createCanaryActivationEvidence({
    ...plan,
    cloudflareDeployments: deploymentsAfter,
    probe,
  });
  writeJson(ACTIVATION_EVIDENCE_PATH, evidence);
  console.log("PASS: bounded 5 percent canary activated and verified; automatic promotion remains prohibited.");
}

async function rollback() {
  required("CLOUDFLARE_API_TOKEN");
  required("CLOUDFLARE_ACCOUNT_ID");
  const activationRunId = required("ACTIVATION_RUN_ID");
  const plan = readJson(PLAN_PATH, "canary plan");
  if (!fs.existsSync(DISABLED_CONFIG_PATH)) throw new Error("disabled release configuration is unavailable for rollback");

  wrangler([
    "versions", "deploy",
    `${plan.stableVersionId}@100%`,
    "--config", DISABLED_CONFIG_PATH,
    "--message", `Automatic fail-closed rollback for canary run ${activationRunId}`,
    "-y",
  ]);

  await new Promise((resolve) => setTimeout(resolve, 3000));
  const deployments = await cloudflare("/deployments");
  const current = deployments?.result?.deployments?.[0]?.versions;
  if (
    !Array.isArray(current)
    || current.length !== 1
    || current[0]?.version_id !== plan.stableVersionId
    || Number(current[0]?.percentage) !== 100
  ) {
    throw new Error("rollback did not restore the disabled stable version to 100 percent");
  }

  const stableVersionDetails = await cloudflare(`/versions/${plan.stableVersionId}`);
  verifyDisabledVersionDetails(stableVersionDetails, plan.stableVersionId);
  writeJson(ROLLBACK_EVIDENCE_PATH, createCanaryRollbackEvidence({
    activationRunId,
    stableVersionId: plan.stableVersionId,
    disabledVersionBindingsVerified: true,
  }));
  console.log("PASS: failed canary disabled; stable version and disabled bindings restored and verified.");
}

async function main() {
  if (process.argv.includes("--activate")) return activate();
  if (process.argv.includes("--rollback")) return rollback();
  throw new Error("--activate or --rollback is required");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`FAIL: ${error.message}`);
    process.exitCode = 1;
  });
}
