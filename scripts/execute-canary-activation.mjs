import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
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
import {
  parseVersionUploadRecord,
  parseWorkerDeployRecord,
} from "../packages/wrangler-output/index.mjs";

const WORKER_NAME = "evenai-ggc-assistant";
const PROBE_URL = "https://getgascert.com/api/assistant/v1/assist";
const OVERRIDE_PROBE_ATTEMPTS = 6;
const OVERRIDE_PROBE_DELAY_MS = 2000;
const AFFINITY_PROBE_ATTEMPTS = 256;
const SERVICE_PROBE_ATTEMPTS = 45;
const SERVICE_PROBE_DELAY_MS = 2000;
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

async function deleteWorkerScript(workerName) {
  const accountId = required("CLOUDFLARE_ACCOUNT_ID");
  const token = required("CLOUDFLARE_API_TOKEN");
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${encodeURIComponent(workerName)}`,
    {
      method: "DELETE",
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/json",
      },
    },
  );
  const body = await response.text();
  if (!response.ok && response.status !== 404) {
    throw new Error(`Cloudflare temporary probe cleanup failed (${response.status}): ${body.slice(0, 300)}`);
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
    gateway: response.headers.get("x-evenai-probe-gateway"),
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

function safeProbeName(activationRunId) {
  const suffix = String(activationRunId ?? "").replace(/[^a-z0-9-]/gi, "-").toLowerCase();
  return `evenai-ggc-canary-probe-${suffix}`.slice(0, 63).replace(/-+$/g, "");
}

export function createServiceBindingProbeDefinition(input = {}) {
  const probeName = nonEmpty(input.probeName, "probeName");
  const canaryVersionId = nonEmpty(input.canaryVersionId, "canaryVersionId");
  const probePath = nonEmpty(input.probePath, "probePath");
  if (!probePath.startsWith("/")) throw new TypeError("probePath must begin with a slash");
  const compatibilityDate = String(input.compatibilityDate ?? "2026-07-20").trim();

  const config = Object.freeze({
    name: probeName,
    main: "./worker.mjs",
    compatibility_date: compatibilityDate,
    workers_dev: true,
    preview_urls: false,
    services: [Object.freeze({ binding: "ASSISTANT", service: WORKER_NAME })],
    vars: Object.freeze({
      TARGET_WORKER_NAME: WORKER_NAME,
      TARGET_VERSION_ID: canaryVersionId,
      PROBE_PATH: probePath,
      APPROVED_ORIGIN: APPROVED_ORIGINS[0],
    }),
  });

  const source = `export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const gatewayHeaders = {
      "cache-control": "no-store",
      "x-evenai-probe-gateway": "temporary-service-binding",
    };

    if (request.method !== "GET" || url.pathname !== env.PROBE_PATH) {
      return new Response("Not found", { status: 404, headers: gatewayHeaders });
    }

    const headers = new Headers({
      origin: env.APPROVED_ORIGIN,
      "content-type": "application/json",
      "Cloudflare-Workers-Version-Overrides":
        env.TARGET_WORKER_NAME + '=\"' + env.TARGET_VERSION_ID + '\"',
    });
    const downstreamRequest = new Request(
      "https://getgascert.com/api/assistant/v1/assist",
      {
        method: "POST",
        headers,
        body: JSON.stringify({ message: "Can you help?" }),
      },
    );
    const downstream = await env.ASSISTANT.fetch(downstreamRequest);
    const responseHeaders = new Headers(downstream.headers);
    responseHeaders.set("cache-control", "no-store");
    responseHeaders.set("x-evenai-probe-gateway", "temporary-service-binding");
    return new Response(downstream.body, {
      status: downstream.status,
      statusText: downstream.statusText,
      headers: responseHeaders,
    });
  },
};
`;

  return Object.freeze({ config, source });
}

export async function probeCanaryThroughServiceBinding(input = {}) {
  const fetchImpl = typeof input.fetchImpl === "function" ? input.fetchImpl : fetch;
  const sleepImpl = typeof input.sleepImpl === "function" ? input.sleepImpl : sleep;
  const canaryVersionId = nonEmpty(input.canaryVersionId, "canaryVersionId");
  const activationRunId = nonEmpty(input.activationRunId, "activationRunId");
  const compatibilityDate = String(input.compatibilityDate ?? "2026-07-20").trim();
  const attempts = positiveInteger(input.attempts ?? SERVICE_PROBE_ATTEMPTS, "attempts");
  const delayMs = Number.isInteger(input.delayMs) && input.delayMs >= 0
    ? input.delayMs
    : SERVICE_PROBE_DELAY_MS;
  const probePath = typeof input.probePath === "string" && input.probePath.trim()
    ? input.probePath.trim()
    : `/probe-${randomUUID()}`;
  const probeName = safeProbeName(activationRunId);
  const directory = path.resolve(`.canary-service-probe-${activationRunId}`);
  const configPath = path.join(directory, "wrangler.jsonc");
  const sourcePath = path.join(directory, "worker.mjs");
  const outputPath = path.join(directory, "deploy-output.ndjson");
  const definition = createServiceBindingProbeDefinition({
    probeName,
    canaryVersionId,
    probePath,
    compatibilityDate,
  });

  fs.rmSync(directory, { recursive: true, force: true });
  fs.mkdirSync(directory, { recursive: true });
  writeJson(configPath, definition.config);
  fs.writeFileSync(sourcePath, definition.source);

  try {
    wrangler(["deploy", "--config", configPath], {
      WRANGLER_OUTPUT_FILE_PATH: outputPath,
    });
    const deployRecord = parseWorkerDeployRecord(
      fs.readFileSync(outputPath, "utf8"),
      probeName,
    );
    const target = deployRecord.targets[0].replace(/\/$/, "");
    let lastProbe = null;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const response = await fetchImpl(`${target}${probePath}?attempt=${attempt}`, {
        method: "GET",
        headers: { "cache-control": "no-store" },
      });
      lastProbe = await readProbe(response);
      console.log(
        `CANARY_SERVICE_BINDING_PROBE attempt=${attempt}/${attempts} status=${lastProbe.status} gateway=${lastProbe.gateway ?? "missing"} service=${lastProbe.service ?? "missing"} version=${lastProbe.versionId ?? "missing"} error=${lastProbe.error ?? "none"}`,
      );
      if (
        lastProbe.gateway === "temporary-service-binding"
        && lastProbe.service === WORKER_NAME
        && lastProbe.versionId === canaryVersionId
      ) {
        return lastProbe;
      }
      if (attempt < attempts && delayMs > 0) await sleepImpl(delayMs);
    }

    throw new Error(
      `service-binding probe did not reach canary version ${canaryVersionId}; last status=${lastProbe?.status ?? "missing"} gateway=${lastProbe?.gateway ?? "missing"} version=${lastProbe?.versionId ?? "missing"}`,
    );
  } finally {
    try {
      await deleteWorkerScript(probeName);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  }
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

  const deploymentsAfter = await cloudflare("/deployments");
  let probe;
  try {
    const route = await resolveCanaryProbeRoute({ canaryVersionId, activationRunId });
    console.log(`PASS: selected canary routing using ${route.mode}.`);
    probe = await probeCanaryApplication({
      canaryVersionId,
      routingHeaders: route.headers,
    });
  } catch (error) {
    console.log(`INFO: public-route targeting was unavailable (${error.message}); using a temporary protected service-binding probe.`);
    probe = await probeCanaryThroughServiceBinding({
      canaryVersionId,
      activationRunId,
      compatibilityDate: prepared.canaryConfig.compatibility_date,
    });
    console.log("PASS: exact canary application verified through a temporary service binding.");
  }

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

  await sleep(3000);
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
