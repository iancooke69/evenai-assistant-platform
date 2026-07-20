import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import {
  currentStableVersionId,
  verifyDisabledVersionDetails,
} from "../packages/canary-activation/index.mjs";

const WORKER_NAME = "evenai-ggc-assistant";
const SOURCE_DIR = "release-source";
const DISABLED_CONFIG_PATH = `${SOURCE_DIR}/wrangler.jsonc`;
const RECOVERY_DELAY_MS = 3000;

function required(name) {
  const value = String(process.env[name] ?? "").trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
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

function wrangler(args) {
  run("npx", ["--yes", "wrangler@4", ...args]);
}

function materializeRelease(releaseCommit) {
  run("git", ["cat-file", "-e", `${releaseCommit}^{commit}`]);
  if (fs.existsSync(SOURCE_DIR)) fs.rmSync(SOURCE_DIR, { recursive: true, force: true });
  run("git", ["worktree", "add", "--detach", SOURCE_DIR, releaseCommit]);
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
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
  if (!response.ok) {
    throw new Error(`Cloudflare API ${apiPath} failed (${response.status}): ${body.slice(0, 300)}`);
  }
  try {
    return JSON.parse(body);
  } catch {
    throw new Error(`Cloudflare API ${apiPath} did not return JSON`);
  }
}

function currentVersions(payload) {
  if (payload?.success !== true) throw new Error("Cloudflare deployment query did not succeed");
  const deployments = payload?.result?.deployments;
  if (!Array.isArray(deployments) || deployments.length === 0) {
    throw new Error("Cloudflare returned no Worker deployments");
  }
  const versions = deployments[0]?.versions;
  if (!Array.isArray(versions) || versions.length === 0) {
    throw new Error("Cloudflare returned no active Worker versions");
  }
  return versions;
}

export function classifyCanaryBaseline(payload) {
  const versions = currentVersions(payload);
  if (versions.length === 1 && Number(versions[0]?.percentage) === 100) {
    return Object.freeze({
      stableVersionId: currentStableVersionId(payload),
      canaryVersionId: null,
      recoveryRequired: false,
    });
  }

  if (versions.length === 2) {
    const stable = versions.find((item) => Number(item?.percentage) === 95);
    const canary = versions.find((item) => Number(item?.percentage) === 5);
    if (stable && canary && stable.version_id !== canary.version_id) {
      return Object.freeze({
        stableVersionId: String(stable.version_id ?? "").trim(),
        canaryVersionId: String(canary.version_id ?? "").trim(),
        recoveryRequired: true,
      });
    }
  }

  throw new Error(
    "activation baseline must be one disabled version at 100 percent or an exact recoverable 95/5 split",
  );
}

function verifyDisabledReleaseConfig(configPath) {
  let config;
  try {
    config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch (error) {
    throw new Error(`Unable to read disabled release configuration: ${error.message}`);
  }
  if (
    config.workers_dev !== false
    || config.vars?.ENABLE_PUBLIC_ASSISTANT !== "false"
    || String(config.vars?.ALLOWED_ORIGINS ?? "").trim() !== ""
  ) {
    throw new Error("release configuration is not in the required disabled posture");
  }
  return true;
}

export async function normalizeCanaryBaseline(input = {}) {
  const releaseCommit = String(input.releaseCommit ?? process.env.RELEASE_COMMIT ?? "").trim();
  if (!releaseCommit) throw new Error("RELEASE_COMMIT is required");
  const activationRunId = String(input.activationRunId ?? process.env.ACTIVATION_RUN_ID ?? "").trim();
  if (!activationRunId) throw new Error("ACTIVATION_RUN_ID is required");

  const cloudflareImpl = typeof input.cloudflareImpl === "function" ? input.cloudflareImpl : cloudflare;
  const materializeReleaseImpl = typeof input.materializeReleaseImpl === "function"
    ? input.materializeReleaseImpl
    : materializeRelease;
  const deployStableImpl = typeof input.deployStableImpl === "function"
    ? input.deployStableImpl
    : ({ stableVersionId }) => wrangler([
      "versions", "deploy",
      `${stableVersionId}@100%`,
      "--config", DISABLED_CONFIG_PATH,
      "--message", `Preflight fail-closed baseline recovery for canary run ${activationRunId}`,
      "-y",
    ]);
  const sleepImpl = typeof input.sleepImpl === "function" ? input.sleepImpl : sleep;
  const configPath = String(input.configPath ?? DISABLED_CONFIG_PATH);

  materializeReleaseImpl(releaseCommit);
  verifyDisabledReleaseConfig(configPath);

  const deploymentsBefore = await cloudflareImpl("/deployments");
  const baseline = classifyCanaryBaseline(deploymentsBefore);
  const stableDetailsBefore = await cloudflareImpl(`/versions/${baseline.stableVersionId}`);
  verifyDisabledVersionDetails(stableDetailsBefore, baseline.stableVersionId);

  if (!baseline.recoveryRequired) {
    console.log(`PASS: disabled baseline already at 100 percent on version ${baseline.stableVersionId}.`);
    return baseline;
  }

  console.log(
    `INFO: exact 95/5 split detected; restoring disabled stable version ${baseline.stableVersionId} to 100 percent before replacement activation.`,
  );
  await deployStableImpl({
    stableVersionId: baseline.stableVersionId,
    canaryVersionId: baseline.canaryVersionId,
    configPath,
    activationRunId,
  });
  await sleepImpl(RECOVERY_DELAY_MS);

  const deploymentsAfter = await cloudflareImpl("/deployments");
  const restoredStableVersionId = currentStableVersionId(deploymentsAfter);
  if (restoredStableVersionId !== baseline.stableVersionId) {
    throw new Error("preflight recovery restored an unexpected stable version");
  }
  const stableDetailsAfter = await cloudflareImpl(`/versions/${restoredStableVersionId}`);
  verifyDisabledVersionDetails(stableDetailsAfter, restoredStableVersionId);

  console.log(
    `PASS: stale bounded split removed; disabled stable version ${restoredStableVersionId} restored to 100 percent.`,
  );
  return Object.freeze({
    stableVersionId: restoredStableVersionId,
    canaryVersionId: baseline.canaryVersionId,
    recoveryRequired: false,
    recovered: true,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  normalizeCanaryBaseline().catch((error) => {
    console.error(`FAIL: ${error.message}`);
    process.exitCode = 1;
  });
}
