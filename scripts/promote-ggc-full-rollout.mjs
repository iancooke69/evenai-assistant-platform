import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import {
  APPROVED_ORIGINS,
  verifyCanaryProbe,
  verifyDisabledVersionDetails,
} from "../packages/canary-activation/index.mjs";
import { classifyCanaryBaseline } from "./normalize-canary-baseline.mjs";

const WORKER_NAME = "evenai-ggc-assistant";
const PROBE_URL = "https://getgascert.com/api/assistant/v1/assist";
const CONFIG_PATH = "wrangler.jsonc";
const PLAN_PATH = "full-rollout-plan.json";
const EVIDENCE_PATH = "full-rollout-evidence.json";
const ROLLBACK_EVIDENCE_PATH = "full-rollout-rollback-evidence.json";
const DEFAULT_AUTHORIZATION_PATH = "deployment-authorizations/ggc-full-rollout-v1.json";
const PROBE_ATTEMPTS = 3;
const PROBE_DELAY_MS = 1500;

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

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8",
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed with exit code ${result.status}`);
}

function wrangler(args) {
  run("npx", ["--yes", "wrangler@4", ...args]);
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

function versionId(value, name) {
  const normalized = String(value ?? "").trim();
  if (!/^[0-9a-f-]{20,64}$/i.test(normalized)) {
    throw new TypeError(`${name} must be a Cloudflare Worker version ID`);
  }
  return normalized;
}

function versionBinding(versionDetails, name) {
  const bindings = versionDetails?.result?.resources?.bindings;
  if (!Array.isArray(bindings)) throw new Error("deployed Worker version bindings are unavailable");
  return bindings.find((candidate) => candidate?.name === name) ?? null;
}

export function validateFullRolloutAuthorization(evidence) {
  if (!evidence || typeof evidence !== "object") {
    throw new TypeError("full rollout authorization is required");
  }
  if (
    evidence.schemaVersion !== 1
    || evidence.decision !== "ggc-full-rollout-authorized"
    || evidence.targetWorker !== WORKER_NAME
    || evidence.requiredStartingAllocation !== "95-disabled-5-enabled"
    || evidence.targetExposurePercent !== 100
    || evidence.ownerConfirmedNoExpectedPublicTraffic !== true
    || evidence.rollbackToDisabledStableRequired !== true
    || evidence.automaticPromotionAuthorized !== false
  ) {
    throw new Error("full rollout authorization is incomplete or outside the approved operation");
  }
  const authorizedBy = String(evidence.authorizedBy ?? "").trim();
  const rationale = String(evidence.rationale ?? "").trim();
  if (!authorizedBy || !rationale) {
    throw new Error("full rollout authorization must identify the owner and rationale");
  }
  return Object.freeze({ authorizedBy, rationale });
}

export function verifyEnabledCanaryVersionDetails(versionDetails, expectedVersionId) {
  const expected = versionId(expectedVersionId, "expectedVersionId");
  if (versionDetails?.success !== true || versionDetails?.result?.id !== expected) {
    throw new Error("Cloudflare canary version details do not match the active 5 percent version");
  }
  const enabled = versionBinding(versionDetails, "ENABLE_PUBLIC_ASSISTANT");
  const origins = versionBinding(versionDetails, "ALLOWED_ORIGINS");
  const limiter = versionBinding(versionDetails, "RATE_LIMITER");
  if (enabled?.type !== "plain_text" || enabled?.text !== "true") {
    throw new Error("the active canary is not enabled");
  }
  const configuredOrigins = new Set(
    String(origins?.text ?? "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  );
  if (
    origins?.type !== "plain_text"
    || configuredOrigins.size !== APPROVED_ORIGINS.length
    || APPROVED_ORIGINS.some((origin) => !configuredOrigins.has(origin))
  ) {
    throw new Error("the active canary does not contain the exact approved origin set");
  }
  if (!limiter) throw new Error("the active canary does not contain the required rate limiter binding");
  return true;
}

export function verifyFullRolloutDeployment(payload, expectedVersionId) {
  const expected = versionId(expectedVersionId, "expectedVersionId");
  if (payload?.success !== true) throw new Error("Cloudflare deployment query did not succeed");
  const deployments = payload?.result?.deployments;
  const versions = deployments?.[0]?.versions;
  if (
    !Array.isArray(versions)
    || versions.length !== 1
    || versions[0]?.version_id !== expected
    || Number(versions[0]?.percentage) !== 100
  ) {
    throw new Error("full rollout did not place the exact enabled canary version at 100 percent");
  }
  return true;
}

async function readProbe(response) {
  const body = (await response.text()).slice(0, 4000);
  return Object.freeze({
    status: response.status,
    corsOrigin: response.headers.get("access-control-allow-origin"),
    service: response.headers.get("x-evenai-service"),
    versionId: response.headers.get("x-evenai-version-id"),
    body,
  });
}

export function verifyFullRolloutProbe(probe, expectedVersionId) {
  const expected = versionId(expectedVersionId, "expectedVersionId");
  if (probe?.service !== WORKER_NAME) {
    throw new Error("full rollout probe did not reach the GetGasCert assistant Worker");
  }
  if (probe?.versionId !== expected) {
    throw new Error("full rollout probe did not reach the exact promoted version");
  }
  verifyCanaryProbe(probe);
  return true;
}

async function probePublicAssistant(canaryVersionId) {
  let lastProbe = null;
  for (let attempt = 1; attempt <= PROBE_ATTEMPTS; attempt += 1) {
    const response = await fetch(PROBE_URL, {
      method: "POST",
      headers: {
        origin: APPROVED_ORIGINS[0],
        "content-type": "application/json",
        "x-request-id": randomUUID(),
        "cache-control": "no-store",
      },
      body: JSON.stringify({ message: "How much is a CP42 certificate?" }),
    });
    lastProbe = await readProbe(response);
    console.log(
      `FULL_ROLLOUT_PROBE attempt=${attempt}/${PROBE_ATTEMPTS} status=${lastProbe.status} service=${lastProbe.service ?? "missing"} version=${lastProbe.versionId ?? "missing"}`,
    );
    verifyFullRolloutProbe(lastProbe, canaryVersionId);
    if (attempt < PROBE_ATTEMPTS) await sleep(PROBE_DELAY_MS);
  }
  return lastProbe;
}

async function promote() {
  required("CLOUDFLARE_API_TOKEN");
  required("CLOUDFLARE_ACCOUNT_ID");
  const rolloutRunId = required("ROLLOUT_RUN_ID");
  const authorizationPath = String(
    process.env.FULL_ROLLOUT_AUTHORIZATION_PATH ?? DEFAULT_AUTHORIZATION_PATH,
  ).trim();
  const authorization = validateFullRolloutAuthorization(
    readJson(authorizationPath, "full rollout authorization"),
  );

  const deploymentsBefore = await cloudflare("/deployments");
  const baseline = classifyCanaryBaseline(deploymentsBefore);
  if (baseline.recoveryRequired !== true || !baseline.stableVersionId || !baseline.canaryVersionId) {
    throw new Error("full rollout requires the exact active 95 percent disabled / 5 percent enabled canary");
  }
  const stableVersionId = versionId(baseline.stableVersionId, "stableVersionId");
  const canaryVersionId = versionId(baseline.canaryVersionId, "canaryVersionId");
  const stableDetails = await cloudflare(`/versions/${stableVersionId}`);
  const canaryDetails = await cloudflare(`/versions/${canaryVersionId}`);
  verifyDisabledVersionDetails(stableDetails, stableVersionId);
  verifyEnabledCanaryVersionDetails(canaryDetails, canaryVersionId);

  const plan = Object.freeze({
    schemaVersion: 1,
    rolloutRunId,
    stableVersionId,
    canaryVersionId,
    authorizedBy: authorization.authorizedBy,
    startingAllocation: { disabledStablePercent: 95, enabledCanaryPercent: 5 },
    targetEnabledPercent: 100,
  });
  writeJson(PLAN_PATH, plan);

  wrangler([
    "versions", "deploy",
    `${canaryVersionId}@100%`,
    "--config", CONFIG_PATH,
    "--message", `Owner-authorized GetGasCert full rollout run ${rolloutRunId}`,
    "-y",
  ]);

  await sleep(3000);
  const deploymentsAfter = await cloudflare("/deployments");
  verifyFullRolloutDeployment(deploymentsAfter, canaryVersionId);
  const promotedDetails = await cloudflare(`/versions/${canaryVersionId}`);
  verifyEnabledCanaryVersionDetails(promotedDetails, canaryVersionId);
  const probe = await probePublicAssistant(canaryVersionId);

  writeJson(EVIDENCE_PATH, {
    schemaVersion: 1,
    decision: "ggc-full-rollout-completed",
    completedAt: new Date().toISOString(),
    rolloutRunId,
    authorizedBy: authorization.authorizedBy,
    rationale: authorization.rationale,
    stableVersionId,
    promotedVersionId: canaryVersionId,
    exposure: { enabledPercent: 100, disabledPercent: 0 },
    controls: {
      approvedOriginsOnly: true,
      rateLimiterRequired: true,
      postRolloutVerificationPassed: true,
      rollbackToDisabledStableOnFailure: true,
    },
    probe: {
      status: probe.status,
      service: probe.service,
      versionId: probe.versionId,
      corsOrigin: probe.corsOrigin,
    },
  });
  console.log(`PASS: GetGasCert assistant version ${canaryVersionId} is live at 100 percent.`);
}

async function rollback() {
  required("CLOUDFLARE_API_TOKEN");
  required("CLOUDFLARE_ACCOUNT_ID");
  const rolloutRunId = required("ROLLOUT_RUN_ID");
  const plan = readJson(PLAN_PATH, "full rollout plan");
  const stableVersionId = versionId(plan.stableVersionId, "stableVersionId");

  wrangler([
    "versions", "deploy",
    `${stableVersionId}@100%`,
    "--config", CONFIG_PATH,
    "--message", `Automatic disabled rollback for full rollout run ${rolloutRunId}`,
    "-y",
  ]);

  await sleep(3000);
  const deployments = await cloudflare("/deployments");
  const versions = deployments?.result?.deployments?.[0]?.versions;
  if (
    !Array.isArray(versions)
    || versions.length !== 1
    || versions[0]?.version_id !== stableVersionId
    || Number(versions[0]?.percentage) !== 100
  ) {
    throw new Error("full rollout rollback did not restore the disabled stable version to 100 percent");
  }
  const stableDetails = await cloudflare(`/versions/${stableVersionId}`);
  verifyDisabledVersionDetails(stableDetails, stableVersionId);
  writeJson(ROLLBACK_EVIDENCE_PATH, {
    schemaVersion: 1,
    decision: "ggc-full-rollout-failed-and-disabled",
    recordedAt: new Date().toISOString(),
    rolloutRunId,
    restoredStableVersionId: stableVersionId,
    restoredDisabledPercent: 100,
    disabledBindingsVerified: true,
  });
  console.log("PASS: failed full rollout restored the disabled stable version at 100 percent.");
}

async function main() {
  if (process.argv.includes("--promote")) return promote();
  if (process.argv.includes("--rollback")) return rollback();
  throw new Error("--promote or --rollback is required");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`FAIL: ${error.message}`);
    process.exitCode = 1;
  });
}
