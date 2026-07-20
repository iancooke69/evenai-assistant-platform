import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import {
  APPROVED_ORIGINS,
  CANARY_LIMITS,
  verifyCanaryProbe,
  verifyDisabledVersionDetails,
} from "../packages/canary-activation/index.mjs";
import { parseVersionUploadRecord } from "../packages/wrangler-output/index.mjs";

const WORKER_NAME = "evenai-ggc-assistant";
const PROBE_URL = "https://getgascert.com/api/assistant/v1/assist";
const BASE_CONFIG_PATH = "wrangler.jsonc";
const ENABLED_CONFIG_PATH = "wrangler.full-rollout-repair.generated.jsonc";
const PLAN_PATH = "full-rollout-repair-plan.json";
const EVIDENCE_PATH = "full-rollout-repair-evidence.json";
const ROLLBACK_EVIDENCE_PATH = "full-rollout-repair-rollback-evidence.json";
const DEFAULT_AUTHORIZATION_PATH = "deployment-authorizations/ggc-full-rollout-repair-v1.json";
const WRANGLER_OUTPUT_PATH = path.resolve("full-rollout-repair-upload.ndjson");
const ROUTE_PROPAGATION_ATTEMPTS = 12;
const ROUTE_PROPAGATION_DELAY_MS = 5000;
const CONFIRMATION_PROBES = 2;

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

function wrangler(args, environment = {}) {
  run("npx", ["--yes", "wrangler@4", ...args], environment);
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

export function validateRepairAuthorization(evidence) {
  if (!evidence || typeof evidence !== "object") {
    throw new TypeError("full rollout repair authorization is required");
  }
  if (
    evidence.schemaVersion !== 1
    || evidence.decision !== "ggc-full-rollout-repair-authorized"
    || evidence.targetWorker !== WORKER_NAME
    || evidence.requiredStartingState !== "one-disabled-version-at-100-percent"
    || evidence.targetExposurePercent !== 100
    || evidence.rollbackToCurrentDisabledVersionRequired !== true
    || evidence.automaticPromotionAuthorized !== false
  ) {
    throw new Error("full rollout repair authorization is incomplete or outside the approved operation");
  }
  const authorizedBy = String(evidence.authorizedBy ?? "").trim();
  const rationale = String(evidence.rationale ?? "").trim();
  if (!authorizedBy || !rationale) {
    throw new Error("full rollout repair authorization must identify the owner and rationale");
  }
  return Object.freeze({ authorizedBy, rationale });
}

export function currentDisabledDeploymentVersionId(payload) {
  if (payload?.success !== true) throw new Error("Cloudflare deployment query did not succeed");
  const versions = payload?.result?.deployments?.[0]?.versions;
  if (
    !Array.isArray(versions)
    || versions.length !== 1
    || Number(versions[0]?.percentage) !== 100
  ) {
    throw new Error("repair requires exactly one currently deployed version at 100 percent");
  }
  return versionId(versions[0]?.version_id, "disabledVersionId");
}

export function createEnabledRepairConfig(baseConfig) {
  const base = structuredClone(baseConfig ?? {});
  const routes = Array.isArray(base.routes) ? base.routes : [];
  if (
    base.name !== WORKER_NAME
    || base.main !== "apps/ggc/worker.mjs"
    || base.workers_dev !== false
    || base.vars?.ENABLE_PUBLIC_ASSISTANT !== "false"
    || routes.length !== 1
    || routes[0]?.pattern !== "getgascert.com/api/assistant/*"
    || routes[0]?.zone_name !== "getgascert.com"
  ) {
    throw new Error("base Wrangler configuration is not the expected disabled GetGasCert production configuration");
  }

  base.preview_urls = false;
  base.vars = {
    ...(base.vars ?? {}),
    ENABLE_PUBLIC_ASSISTANT: "true",
    ALLOWED_ORIGINS: APPROVED_ORIGINS.join(","),
    RATE_LIMIT_RETRY_AFTER_SECONDS: "60",
  };
  base.ratelimits = [{
    name: "RATE_LIMITER",
    namespace_id: "26071901",
    simple: {
      limit: CANARY_LIMITS.maximumRequestsPerMinutePerClient,
      period: 60,
    },
  }];
  base.observability = {
    enabled: true,
    head_sampling_rate: 1,
  };
  base.version_metadata = { binding: "CF_VERSION_METADATA" };
  return Object.freeze(base);
}

export function verifyEnabledRepairVersionDetails(versionDetails, expectedVersionId) {
  const expected = versionId(expectedVersionId, "expectedVersionId");
  if (versionDetails?.success !== true || versionDetails?.result?.id !== expected) {
    throw new Error("Cloudflare enabled repair version details do not match the uploaded version");
  }
  const enabled = versionBinding(versionDetails, "ENABLE_PUBLIC_ASSISTANT");
  const origins = versionBinding(versionDetails, "ALLOWED_ORIGINS");
  const limiter = versionBinding(versionDetails, "RATE_LIMITER");
  const metadata = versionBinding(versionDetails, "CF_VERSION_METADATA");
  if (enabled?.type !== "plain_text" || enabled?.text !== "true") {
    throw new Error("uploaded repair version is not enabled");
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
    throw new Error("uploaded repair version does not contain the exact approved origin set");
  }
  if (!limiter) throw new Error("uploaded repair version does not contain the required rate limiter binding");
  if (!metadata) throw new Error("uploaded repair version does not contain version metadata");
  return true;
}

export function verifyEnabledRepairDeployment(payload, expectedVersionId) {
  const expected = versionId(expectedVersionId, "expectedVersionId");
  if (payload?.success !== true) throw new Error("Cloudflare deployment query did not succeed");
  const versions = payload?.result?.deployments?.[0]?.versions;
  if (
    !Array.isArray(versions)
    || versions.length !== 1
    || versions[0]?.version_id !== expected
    || Number(versions[0]?.percentage) !== 100
  ) {
    throw new Error("repair did not place the exact newly uploaded enabled version at 100 percent");
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

export function verifyEnabledRepairProbe(probe, expectedVersionId) {
  const expected = versionId(expectedVersionId, "expectedVersionId");
  if (probe?.service !== WORKER_NAME) {
    throw new Error("repair probe did not reach the GetGasCert assistant Worker");
  }
  if (probe?.versionId !== expected) {
    throw new Error("repair probe did not reach the exact newly uploaded enabled version");
  }
  verifyCanaryProbe(probe);
  return true;
}

async function makePublicProbe() {
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
  return readProbe(response);
}

async function verifyPublicRoute(enabledVersionId) {
  let firstSuccess = null;
  let lastProbe = null;
  for (let attempt = 1; attempt <= ROUTE_PROPAGATION_ATTEMPTS; attempt += 1) {
    lastProbe = await makePublicProbe();
    console.log(
      `FULL_ROLLOUT_REPAIR_PROBE attempt=${attempt}/${ROUTE_PROPAGATION_ATTEMPTS} status=${lastProbe.status} service=${lastProbe.service ?? "missing"} version=${lastProbe.versionId ?? "missing"}`,
    );
    try {
      verifyEnabledRepairProbe(lastProbe, enabledVersionId);
      firstSuccess = lastProbe;
      break;
    } catch (error) {
      console.log(`INFO: public repair route not ready: ${error.message}`);
    }
    if (attempt < ROUTE_PROPAGATION_ATTEMPTS) await sleep(ROUTE_PROPAGATION_DELAY_MS);
  }
  if (!firstSuccess) {
    throw new Error(
      `public route did not expose enabled version ${enabledVersionId}; last status=${lastProbe?.status ?? "missing"} version=${lastProbe?.versionId ?? "missing"}`,
    );
  }

  let finalProbe = firstSuccess;
  for (let confirmation = 1; confirmation <= CONFIRMATION_PROBES; confirmation += 1) {
    await sleep(1500);
    finalProbe = await makePublicProbe();
    console.log(
      `FULL_ROLLOUT_REPAIR_CONFIRM confirmation=${confirmation}/${CONFIRMATION_PROBES} status=${finalProbe.status} service=${finalProbe.service ?? "missing"} version=${finalProbe.versionId ?? "missing"}`,
    );
    verifyEnabledRepairProbe(finalProbe, enabledVersionId);
  }
  return finalProbe;
}

async function repair() {
  required("CLOUDFLARE_API_TOKEN");
  required("CLOUDFLARE_ACCOUNT_ID");
  const repairRunId = required("REPAIR_RUN_ID");
  const authorizationPath = String(
    process.env.FULL_ROLLOUT_REPAIR_AUTHORIZATION_PATH ?? DEFAULT_AUTHORIZATION_PATH,
  ).trim();
  const authorization = validateRepairAuthorization(
    readJson(authorizationPath, "full rollout repair authorization"),
  );

  const deploymentsBefore = await cloudflare("/deployments");
  const disabledVersionId = currentDisabledDeploymentVersionId(deploymentsBefore);
  const disabledVersionDetails = await cloudflare(`/versions/${disabledVersionId}`);
  verifyDisabledVersionDetails(disabledVersionDetails, disabledVersionId);

  const enabledConfig = createEnabledRepairConfig(
    readJson(BASE_CONFIG_PATH, "disabled production Wrangler configuration"),
  );
  writeJson(ENABLED_CONFIG_PATH, enabledConfig);

  const plan = {
    schemaVersion: 1,
    repairRunId,
    authorizedBy: authorization.authorizedBy,
    disabledVersionId,
    enabledVersionId: null,
    targetEnabledPercent: 100,
  };
  writeJson(PLAN_PATH, plan);

  if (fs.existsSync(WRANGLER_OUTPUT_PATH)) fs.rmSync(WRANGLER_OUTPUT_PATH, { force: true });
  wrangler([
    "versions", "upload",
    "--config", ENABLED_CONFIG_PATH,
    "--tag", `full-rollout-repair-${repairRunId}`,
    "--message", `Owner-authorized GetGasCert enabled repair run ${repairRunId}`,
  ], {
    WRANGLER_OUTPUT_FILE_PATH: WRANGLER_OUTPUT_PATH,
  });

  const uploadRecord = parseVersionUploadRecord(
    fs.readFileSync(WRANGLER_OUTPUT_PATH, "utf8"),
    WORKER_NAME,
  );
  const enabledVersionId = versionId(uploadRecord.versionId, "enabledVersionId");
  plan.enabledVersionId = enabledVersionId;
  writeJson(PLAN_PATH, plan);

  const uploadedDetails = await cloudflare(`/versions/${enabledVersionId}`);
  verifyEnabledRepairVersionDetails(uploadedDetails, enabledVersionId);

  wrangler([
    "versions", "deploy",
    `${enabledVersionId}@100%`,
    "--config", ENABLED_CONFIG_PATH,
    "--message", `Repair GetGasCert assistant to enabled 100 percent run ${repairRunId}`,
    "-y",
  ]);

  await sleep(3000);
  const deploymentsAfter = await cloudflare("/deployments");
  verifyEnabledRepairDeployment(deploymentsAfter, enabledVersionId);
  const activeDetails = await cloudflare(`/versions/${enabledVersionId}`);
  verifyEnabledRepairVersionDetails(activeDetails, enabledVersionId);
  const probe = await verifyPublicRoute(enabledVersionId);

  writeJson(EVIDENCE_PATH, {
    schemaVersion: 1,
    decision: "ggc-full-rollout-repaired-and-enabled",
    completedAt: new Date().toISOString(),
    repairRunId,
    authorizedBy: authorization.authorizedBy,
    rationale: authorization.rationale,
    previousDisabledVersionId: disabledVersionId,
    enabledVersionId,
    exposure: { enabledPercent: 100, disabledPercent: 0 },
    controls: {
      approvedOriginsOnly: true,
      maximumRequestsPerMinutePerClient: CANARY_LIMITS.maximumRequestsPerMinutePerClient,
      rateLimiterRequired: true,
      observabilityEnabled: true,
      publicRouteVerificationPassed: true,
      rollbackToPreviousDisabledVersionOnFailure: true,
    },
    probe: {
      status: probe.status,
      service: probe.service,
      versionId: probe.versionId,
      corsOrigin: probe.corsOrigin,
    },
  });
  console.log(`PASS: GetGasCert assistant version ${enabledVersionId} is enabled and verified at 100 percent.`);
}

async function rollback() {
  required("CLOUDFLARE_API_TOKEN");
  required("CLOUDFLARE_ACCOUNT_ID");
  const repairRunId = required("REPAIR_RUN_ID");
  const plan = readJson(PLAN_PATH, "full rollout repair plan");
  const disabledVersionId = versionId(plan.disabledVersionId, "disabledVersionId");

  wrangler([
    "versions", "deploy",
    `${disabledVersionId}@100%`,
    "--config", BASE_CONFIG_PATH,
    "--message", `Automatic disabled rollback for GetGasCert repair run ${repairRunId}`,
    "-y",
  ]);

  await sleep(3000);
  const deployments = await cloudflare("/deployments");
  const current = currentDisabledDeploymentVersionId(deployments);
  if (current !== disabledVersionId) {
    throw new Error("repair rollback did not restore the previous disabled version at 100 percent");
  }
  const disabledDetails = await cloudflare(`/versions/${disabledVersionId}`);
  verifyDisabledVersionDetails(disabledDetails, disabledVersionId);
  writeJson(ROLLBACK_EVIDENCE_PATH, {
    schemaVersion: 1,
    decision: "ggc-full-rollout-repair-failed-and-disabled",
    recordedAt: new Date().toISOString(),
    repairRunId,
    restoredDisabledVersionId: disabledVersionId,
    restoredDisabledPercent: 100,
    disabledBindingsVerified: true,
  });
  console.log("PASS: failed repair restored the previous disabled Worker version at 100 percent.");
}

async function main() {
  if (process.argv.includes("--repair")) return repair();
  if (process.argv.includes("--rollback")) return rollback();
  throw new Error("--repair or --rollback is required");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`FAIL: ${error.message}`);
    process.exitCode = 1;
  });
}
