import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import {
  activationBaseline,
  APPROVED_ORIGINS,
  createCanaryActivationEvidence,
  createCanaryRollbackEvidence,
  currentStableVersionId,
  prepareCanaryActivation,
  validateCanaryAuthorization,
  verifyDisabledVersionDetails,
} from "../packages/canary-activation/index.mjs";
import { parseVersionUploadRecord } from "../packages/wrangler-output/index.mjs";

const WORKER_NAME = "evenai-ggc-assistant";
const PROBE_URL = "https://getgascert.com/api/assistant/v1/assist";
const OVERRIDE_PROBE_ATTEMPTS = 6;
const OVERRIDE_PROBE_DELAY_MS = 2000;
const AFFINITY_PROBE_ATTEMPTS = 256;
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

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function positiveInteger(value, name) {
  if (!Number.isInteger(value) || value <= 0) throw new TypeError(`${name} must be a positive integer`);
  return value;
}

function nonEmpty(value, name) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new TypeError(`${name} is required`);
  return normalized;
}

async function readProbe(response) {
  const body = (await response.text()).slice(0, 2000);
  let parsed = null;
  try {
    parsed = body ? JSON.parse(body) : null;
  } catch {
    parsed = null;
  }
  return Object.freeze({
    status: response.status,
    corsOrigin: response.headers.get("access-control-allow-origin"),
    service: response.headers.get("x-evenai-service"),
    versionId: response.headers.get("x-evenai-version-id"),
    error: typeof parsed?.error === "string" ? parsed.error : null,
    body,
  });
}

function versionOverrideHeader(canaryVersionId) {
  return `${WORKER_NAME}="${canaryVersionId}"`;
}

async function routingProbe(fetchImpl, routingHeaders) {
  const response = await fetchImpl(PROBE_URL, {
    method: "OPTIONS",
    headers: {
      origin: APPROVED_ORIGINS[0],
      ...routingHeaders,
    },
  });
  return readProbe(response);
}

function isCanaryRoutingProbe(probe, canaryVersionId) {
  return probe?.status === 204
    && probe?.service === WORKER_NAME
    && probe?.versionId === canaryVersionId;
}

function logRoutingProbe(prefix, attempt, total, probe) {
  console.log(
    `${prefix} attempt=${attempt}/${total} status=${probe.status} service=${probe.service ?? "missing"} version=${probe.versionId ?? "missing"} error=${probe.error ?? "none"}`,
  );
}

export async function resolveCanaryProbeRoute(input = {}) {
  const fetchImpl = typeof input.fetchImpl === "function" ? input.fetchImpl : fetch;
  const sleepImpl = typeof input.sleepImpl === "function" ? input.sleepImpl : sleep;
  const canaryVersionId = nonEmpty(input.canaryVersionId, "canaryVersionId");
  const activationRunId = nonEmpty(input.activationRunId, "activationRunId");
  const overrideAttempts = positiveInteger(
    input.overrideAttempts ?? OVERRIDE_PROBE_ATTEMPTS,
    "overrideAttempts",
  );
  const affinityAttempts = positiveInteger(
    input.affinityAttempts ?? AFFINITY_PROBE_ATTEMPTS,
    "affinityAttempts",
  );
  const overrideDelayMs = Number.isInteger(input.overrideDelayMs) && input.overrideDelayMs >= 0
    ? input.overrideDelayMs
    : OVERRIDE_PROBE_DELAY_MS;

  const overrideHeaders = Object.freeze({
    "Cloudflare-Workers-Version-Overrides": versionOverrideHeader(canaryVersionId),
  });
  let lastProbe = null;

  for (let attempt = 1; attempt <= overrideAttempts; attempt += 1) {
    lastProbe = await routingProbe(fetchImpl, overrideHeaders);
    logRoutingProbe("CANARY_OVERRIDE_PROBE", attempt, overrideAttempts, lastProbe);
    if (isCanaryRoutingProbe(lastProbe, canaryVersionId)) {
      return Object.freeze({ mode: "version-override", headers: overrideHeaders, probe: lastProbe });
    }
    if (attempt < overrideAttempts && overrideDelayMs > 0) await sleepImpl(overrideDelayMs);
  }

  console.log("INFO: version override did not select the canary; checking the live 5 percent split with deterministic version-affinity keys.");

  for (let attempt = 1; attempt <= affinityAttempts; attempt += 1) {
    const affinityKey = `canary-probe-${activationRunId}-${attempt}`;
    const affinityHeaders = Object.freeze({
      "Cloudflare-Workers-Version-Key": affinityKey,
    });
    const probe = await routingProbe(fetchImpl, affinityHeaders);

    if (attempt === 1 || attempt % 32 === 0 || isCanaryRoutingProbe(probe, canaryVersionId)) {
      logRoutingProbe("CANARY_AFFINITY_PROBE", attempt, affinityAttempts, probe);
    }

    if (!isCanaryRoutingProbe(probe, canaryVersionId)) {
      lastProbe = probe;
      continue;
    }

    const confirmation = await routingProbe(fetchImpl, affinityHeaders);
    logRoutingProbe("CANARY_AFFINITY_CONFIRM", attempt, affinityAttempts, confirmation);
    if (isCanaryRoutingProbe(confirmation, canaryVersionId)) {
      return Object.freeze({ mode: "version-affinity", headers: affinityHeaders, probe: confirmation });
    }
    lastProbe = confirmation;
  }

  throw new Error(
    `unable to route a protected probe to canary version ${canaryVersionId}; last observed=${lastProbe?.versionId ?? "missing"}`,
  );
}

export async function probeCanaryApplication(input = {}) {
  const fetchImpl = typeof input.fetchImpl === "function" ? input.fetchImpl : fetch;
  const canaryVersionId = nonEmpty(input.canaryVersionId, "canaryVersionId");
  const routingHeaders = input.routingHeaders && typeof input.routingHeaders === "object"
    ? input.routingHeaders
    : {};
  const response = await fetchImpl(PROBE_URL, {
    method: "POST",
    headers: {
      origin: APPROVED_ORIGINS[0],
      "content-type": "application/json",
      ...routingHeaders,
    },
    body: JSON.stringify({ message: "Can you help?" }),
  });
  const probe = await readProbe(response);
  console.log(
    `CANARY_APPLICATION_PROBE status=${probe.status} service=${probe.service ?? "missing"} version=${probe.versionId ?? "missing"} error=${probe.error ?? "none"}`,
  );
  if (probe.service !== WORKER_NAME) {
    throw new Error(`canary application probe did not reach ${WORKER_NAME}; status=${probe.status}`);
  }
  if (probe.versionId !== canaryVersionId) {
    throw new Error(`canary application probe changed version; observed=${probe.versionId ?? "missing"}`);
  }
  return probe;
}

async function restoreStableBaseline({ stableVersionId, activationRunId, message }) {
  wrangler([
    "versions", "deploy",
    `${stableVersionId}@100%`,
    "--config", DISABLED_CONFIG_PATH,
    "--message", message,
    "-y",
  ]);

  await sleep(3000);
  const deployments = await cloudflare("/deployments");
  const restoredStableVersionId = currentStableVersionId(deployments);
  if (restoredStableVersionId !== stableVersionId) {
    throw new Error("stable baseline recovery selected an unexpected Worker version");
  }
  const stableVersionDetails = await cloudflare(`/versions/${stableVersionId}`);
  verifyDisabledVersionDetails(stableVersionDetails, stableVersionId);
  console.log(`PASS: stable disabled baseline restored for activation run ${activationRunId}.`);
  return Object.freeze({ deployments, stableVersionDetails });
}

async function activate() {
  required("CLOUDFLARE_API_TOKEN");
  required("CLOUDFLARE_ACCOUNT_ID");
  const releaseCommit = required("RELEASE_COMMIT");
  const activationRunId = required("ACTIVATION_RUN_ID");
  const latestDeploymentRunId = required("LATEST_DEPLOYMENT_RUN_ID");
  const authorizationPath = required("CANARY_AUTHORIZATION_PATH");
  const authorizationEvidence = readJson(authorizationPath, "canary authorization evidence");
  const authorization = validateCanaryAuthorization(authorizationEvidence, latestDeploymentRunId);
  if (authorization.releaseCommit !== releaseCommit.toLowerCase()) {
    throw new Error("canary authorization release does not match the requested release commit");
  }

  materializeRelease(releaseCommit);
  const baseConfig = readJson(DISABLED_CONFIG_PATH, "release Wrangler configuration");
  let deploymentsBefore = await cloudflare("/deployments");
  const baseline = activationBaseline(deploymentsBefore);
  let stableVersionDetails = await cloudflare(`/versions/${baseline.stableVersionId}`);
  verifyDisabledVersionDetails(stableVersionDetails, baseline.stableVersionId);

  if (baseline.mode === "bounded-canary") {
    writeJson(PLAN_PATH, {
      schemaVersion: 1,
      releaseCommit: authorization.releaseCommit,
      deploymentRunId: authorization.deploymentRunId,
      authorizationRunId: authorization.authorizationRunId,
      activationRunId,
      stableVersionId: baseline.stableVersionId,
      canaryVersionId: baseline.canaryVersionId,
      recoveryOnly: true,
    });
    console.log(
      `INFO: found an existing exact 95/5 canary; restoring disabled stable version ${baseline.stableVersionId} before a fresh authorized activation.`,
    );
    const restored = await restoreStableBaseline({
      stableVersionId: baseline.stableVersionId,
      activationRunId,
      message: `Pre-activation recovery to disabled baseline for run ${activationRunId}`,
    });
    deploymentsBefore = restored.deployments;
    stableVersionDetails = restored.stableVersionDetails;
  }

  const prepared = prepareCanaryActivation({
    authorizationEvidence,
    latestDeploymentRunId,
    activationRunId,
    cloudflareDeployments: deploymentsBefore,
    stableVersionDetails,
    baseConfig,
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

  const deploymentsAfter = await cloudflare("/deployments");
  const route = await resolveCanaryProbeRoute({ canaryVersionId, activationRunId });
  console.log(`PASS: selected canary routing using ${route.mode}.`);
  const probe = await probeCanaryApplication({
    canaryVersionId,
    routingHeaders: route.headers,
  });

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

  await restoreStableBaseline({
    stableVersionId: plan.stableVersionId,
    activationRunId,
    message: `Automatic fail-closed rollback for canary run ${activationRunId}`,
  });
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
