import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import {
  createEnabledRepairConfig,
  verifyEnabledRepairDeployment,
  verifyEnabledRepairProbe,
  verifyEnabledRepairVersionDetails,
} from "./repair-ggc-full-rollout.mjs";
import { parseVersionUploadRecord } from "../packages/wrangler-output/index.mjs";

const WORKER_NAME = "evenai-ggc-assistant";
const PROBE_URL = "https://getgascert.com/api/assistant/v1/assist";
const ORIGIN = "https://getgascert.com";
const BASE_CONFIG = "wrangler.jsonc";
const ENABLED_CONFIG = "wrangler.enabled-update.generated.jsonc";
const AUTH_PATH = "deployment-authorizations/ggc-enabled-production-update-2026-08-13.json";
const PLAN_PATH = "ggc-enabled-update-plan.json";
const EVIDENCE_PATH = "ggc-enabled-update-evidence.json";
const ROLLBACK_PATH = "ggc-enabled-update-rollback-evidence.json";
const UPLOAD_OUTPUT = "ggc-enabled-update-upload.ndjson";

function required(name) {
  const value = String(process.env[name] ?? "").trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function versionId(value, label) {
  const id = String(value ?? "").trim();
  if (!/^[0-9a-f-]{20,64}$/i.test(id)) throw new Error(`${label} is not a Worker version ID`);
  return id;
}

function runWrangler(args, extraEnv = {}) {
  const result = spawnSync("npx", ["--yes", "wrangler@4", ...args], {
    cwd: process.cwd(),
    env: { ...process.env, ...extraEnv },
    encoding: "utf8",
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`wrangler failed with exit code ${result.status}`);
}

function validateAuthorization(value) {
  if (
    value?.schemaVersion !== 1
    || value?.decision !== "ggc-enabled-production-update-authorized"
    || value?.targetWorker !== WORKER_NAME
    || value?.requiredStartingState !== "one-enabled-version-at-100-percent"
    || value?.targetExposurePercent !== 100
    || value?.rollbackToCurrentEnabledVersionRequired !== true
    || value?.automaticFutureUpdatesAuthorized !== false
    || !String(value?.authorizedBy ?? "").trim()
    || !String(value?.rationale ?? "").trim()
  ) throw new Error("enabled update authorization is invalid or incomplete");
  return value;
}

async function cf(path) {
  const account = required("CLOUDFLARE_ACCOUNT_ID");
  const token = required("CLOUDFLARE_API_TOKEN");
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/${WORKER_NAME}${path}`, {
    headers: { authorization: `Bearer ${token}`, accept: "application/json" },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Cloudflare ${path} failed (${response.status}): ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

export function oneVersionAt100(payload) {
  if (payload?.success !== true) throw new Error("deployment query failed");
  const versions = payload?.result?.deployments?.[0]?.versions;
  if (!Array.isArray(versions) || versions.length !== 1 || Number(versions[0]?.percentage) !== 100) {
    throw new Error("exactly one Worker version at 100 percent is required");
  }
  return versionId(versions[0].version_id, "deployed version");
}

async function probe(message) {
  const response = await fetch(PROBE_URL, {
    method: "POST",
    headers: {
      origin: ORIGIN,
      referer: `${ORIGIN}/`,
      "content-type": "application/json",
      "x-request-id": `deploy-${randomUUID()}`,
      "cache-control": "no-store",
    },
    body: JSON.stringify({ message }),
  });
  const body = (await response.text()).slice(0, 8000);
  let json = null;
  try { json = JSON.parse(body); } catch {}
  return {
    status: response.status,
    corsOrigin: response.headers.get("access-control-allow-origin"),
    service: response.headers.get("x-evenai-service"),
    versionId: response.headers.get("x-evenai-version-id"),
    body,
    json,
  };
}

function answer(probeResult, expectedVersion, label) {
  verifyEnabledRepairProbe(probeResult, expectedVersion);
  const result = probeResult?.json?.result;
  const text = String(result?.response?.text ?? "");
  if (!text) throw new Error(`${label}: answer text missing`);
  return { result, text };
}

function requireMatches(text, patterns, label) {
  for (const pattern of patterns) if (!pattern.test(text)) throw new Error(`${label} failed ${pattern}: ${text}`);
}

async function waitForNewVersion(expectedVersion) {
  let last = null;
  for (let i = 1; i <= 4; i += 1) {
    last = await probe("How much is a CP42 certificate?");
    try {
      const { text } = answer(last, expectedVersion, "CP42 readiness");
      requireMatches(text, [/CP42/i, /£249/], "CP42 readiness");
      return last;
    } catch (error) {
      console.log(`INFO: readiness ${i}/4: ${error.message}`);
      if (i < 4) await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
  throw new Error(`updated version did not become ready; last version=${last?.versionId ?? "missing"}`);
}

async function liveSuite(expectedVersion) {
  const cases = [
    ["CP44", "I operate an LPG mobile catering trailer. Which gas certificate do I need?", [/CP44/i, /£199/], null],
    ["CP12", "I am a landlord with a residential rental property. Which gas certificate do I need?", [/CP12/i, /£119/], null],
    ["emergency", "I can smell gas and think there may be an immediate danger. What should I do?", [/0800\s*111\s*999/], null],
    ["area", "Which areas do GetGasCert cover?", [/Norfolk/i, /Suffolk/i, /Cambridgeshire/i, /Essex/i], null],
    ["prices", "How much are CP12, CP42 and CP44?", [/CP12[^£]*£119/i, /CP42[^£]*£249/i, /CP44[^£]*£199/i], null],
    ["website", "What is your refund and cancellation policy?", [/refund|cancellation|reschedul/i], "website-knowledge"],
  ];
  const evidence = [];
  for (const [label, question, patterns, expectedRoute] of cases) {
    const p = await probe(question);
    const { result, text } = answer(p, expectedVersion, label);
    requireMatches(text, patterns, label);
    if (expectedRoute && result.route !== expectedRoute) throw new Error(`${label}: expected ${expectedRoute}, got ${result.route}`);
    evidence.push({ label, route: result.route, status: p.status, answer: text });
  }
  return evidence;
}

async function update() {
  required("CLOUDFLARE_API_TOKEN");
  required("CLOUDFLARE_ACCOUNT_ID");
  const runId = required("UPDATE_RUN_ID");
  const auth = validateAuthorization(readJson(AUTH_PATH));

  const before = await cf("/deployments");
  const previousVersion = oneVersionAt100(before);
  verifyEnabledRepairVersionDetails(await cf(`/versions/${previousVersion}`), previousVersion);

  const enabledConfig = createEnabledRepairConfig(readJson(BASE_CONFIG));
  writeJson(ENABLED_CONFIG, enabledConfig);
  const plan = {
    schemaVersion: 1,
    runId,
    sourceCommit: String(process.env.GITHUB_SHA ?? "").trim() || null,
    previousEnabledVersionId: previousVersion,
    newEnabledVersionId: null,
  };
  writeJson(PLAN_PATH, plan);

  if (fs.existsSync(UPLOAD_OUTPUT)) fs.rmSync(UPLOAD_OUTPUT, { force: true });
  runWrangler([
    "versions", "upload", "--config", ENABLED_CONFIG,
    "--tag", `enabled-update-${runId}`,
    "--message", `Owner-authorized GetGasCert enabled update ${runId}`,
  ], { WRANGLER_OUTPUT_FILE_PATH: UPLOAD_OUTPUT });

  const record = parseVersionUploadRecord(fs.readFileSync(UPLOAD_OUTPUT, "utf8"), WORKER_NAME);
  const newVersion = versionId(record.versionId, "new version");
  plan.newEnabledVersionId = newVersion;
  writeJson(PLAN_PATH, plan);
  verifyEnabledRepairVersionDetails(await cf(`/versions/${newVersion}`), newVersion);

  runWrangler([
    "versions", "deploy", `${newVersion}@100%`, "--config", ENABLED_CONFIG,
    "--message", `GetGasCert enabled production update ${runId}`, "-y",
  ]);
  await new Promise((resolve) => setTimeout(resolve, 3000));
  verifyEnabledRepairDeployment(await cf("/deployments"), newVersion);
  verifyEnabledRepairVersionDetails(await cf(`/versions/${newVersion}`), newVersion);

  const readiness = await waitForNewVersion(newVersion);
  const checks = await liveSuite(newVersion);
  writeJson(EVIDENCE_PATH, {
    schemaVersion: 1,
    decision: "ggc-enabled-production-update-passed",
    completedAt: new Date().toISOString(),
    runId,
    sourceCommit: plan.sourceCommit,
    authorizedBy: auth.authorizedBy,
    rationale: auth.rationale,
    previousEnabledVersionId: previousVersion,
    newEnabledVersionId: newVersion,
    controls: {
      previousVersionVerifiedEnabled: true,
      newVersionVerifiedEnabledBeforeTraffic: true,
      approvedOriginsPreserved: true,
      rateLimiterPreserved: true,
      observabilityPreserved: true,
      rollbackToPreviousEnabledVersionOnFailure: true,
      liveSuitePassed: true,
    },
    readiness: { status: readiness.status, versionId: readiness.versionId, service: readiness.service },
    checks,
  });
  console.log(`PASS: updated ${previousVersion} -> ${newVersion} at 100 percent.`);
}

async function rollback() {
  required("CLOUDFLARE_API_TOKEN");
  required("CLOUDFLARE_ACCOUNT_ID");
  const runId = required("UPDATE_RUN_ID");
  const plan = readJson(PLAN_PATH);
  const previous = versionId(plan.previousEnabledVersionId, "previous version");
  const enabledConfig = fs.existsSync(ENABLED_CONFIG)
    ? readJson(ENABLED_CONFIG)
    : createEnabledRepairConfig(readJson(BASE_CONFIG));
  writeJson(ENABLED_CONFIG, enabledConfig);
  runWrangler([
    "versions", "deploy", `${previous}@100%`, "--config", ENABLED_CONFIG,
    "--message", `Automatic enabled rollback ${runId}`, "-y",
  ]);
  await new Promise((resolve) => setTimeout(resolve, 3000));
  if (oneVersionAt100(await cf("/deployments")) !== previous) throw new Error("rollback did not restore previous enabled version");
  verifyEnabledRepairVersionDetails(await cf(`/versions/${previous}`), previous);
  const p = await probe("How much is a CP42 certificate?");
  verifyEnabledRepairProbe(p, previous);
  writeJson(ROLLBACK_PATH, {
    schemaVersion: 1,
    decision: "ggc-enabled-production-update-failed-and-rolled-back",
    recordedAt: new Date().toISOString(),
    runId,
    restoredEnabledVersionId: previous,
    restoredEnabledPercent: 100,
    bindingsVerified: true,
    publicProbePassed: true,
  });
  console.log(`PASS: restored previous enabled version ${previous} at 100 percent.`);
}

async function main() {
  if (process.argv.includes("--update")) return update();
  if (process.argv.includes("--rollback")) return rollback();
  throw new Error("--update or --rollback is required");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`FAIL: ${error.message}`);
    process.exitCode = 1;
  });
}
