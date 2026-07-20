import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import {
  activationBaseline,
  APPROVED_ORIGINS,
} from "../packages/canary-activation/index.mjs";
import { parseWorkerDeployRecord } from "../packages/wrangler-output/index.mjs";

const ASSISTANT_WORKER_NAME = "evenai-ggc-assistant";
const GATEWAY_WORKER_NAME = "evenai-ggc-owner-canary-test";
const OWNER_TOKEN_SHA256 = "df8fb9b89cdc5aa332ee82b0e7e6e90f6139ab123d4541f8b2b88a4a2058d28d";
const GENERATED_CONFIG_PATH = path.resolve("owner-canary-test.wrangler.generated.jsonc");
const WRANGLER_OUTPUT_PATH = path.resolve("owner-canary-test.deploy.ndjson");
const ROUTE_ATTEMPTS = 45;
const ROUTE_DELAY_MS = 2000;

function required(name) {
  const value = String(process.env[name] ?? "").trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function validVersionId(value, name = "versionId") {
  const normalized = String(value ?? "").trim();
  if (!/^[0-9a-f-]{20,64}$/i.test(normalized)) {
    throw new TypeError(`${name} must be a Cloudflare Worker version ID`);
  }
  return normalized;
}

function validTokenHash(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new TypeError("owner token hash must be a SHA-256 hex digest");
  }
  return normalized;
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

async function cloudflare(pathname, options = {}) {
  const accountId = required("CLOUDFLARE_ACCOUNT_ID");
  const token = required("CLOUDFLARE_API_TOKEN");
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}${pathname}`,
    {
      ...options,
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/json",
        ...(options.headers ?? {}),
      },
    },
  );
  const body = await response.text();
  if (!response.ok && !(options.allowNotFound === true && response.status === 404)) {
    throw new Error(`Cloudflare API ${pathname} failed (${response.status}): ${body.slice(0, 300)}`);
  }
  if (!body) return null;
  try {
    return JSON.parse(body);
  } catch {
    throw new Error(`Cloudflare API ${pathname} did not return JSON`);
  }
}

function versionBinding(versionDetails, name) {
  const bindings = versionDetails?.result?.resources?.bindings;
  if (!Array.isArray(bindings)) return null;
  return bindings.find((candidate) => candidate?.name === name) ?? null;
}

export function verifyEnabledCanaryVersion(versionDetails, expectedVersionId) {
  const versionId = validVersionId(expectedVersionId, "expectedVersionId");
  if (versionDetails?.success !== true || versionDetails?.result?.id !== versionId) {
    throw new Error("Cloudflare canary version details do not match the active 5 percent version");
  }

  const enabled = versionBinding(versionDetails, "ENABLE_PUBLIC_ASSISTANT");
  const origins = versionBinding(versionDetails, "ALLOWED_ORIGINS");
  if (enabled?.type !== "plain_text" || enabled?.text !== "true") {
    throw new Error("the active 5 percent version is not enabled");
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
  return true;
}

export function createOwnerCanaryConfig(input = {}) {
  const targetVersionId = validVersionId(input.targetVersionId, "targetVersionId");
  const ownerTokenHash = validTokenHash(input.ownerTokenHash ?? OWNER_TOKEN_SHA256);
  return Object.freeze({
    $schema: "./node_modules/wrangler/config-schema.json",
    name: GATEWAY_WORKER_NAME,
    main: "apps/ggc/owner-canary-test-worker.mjs",
    compatibility_date: "2026-07-20",
    workers_dev: true,
    preview_urls: false,
    services: [Object.freeze({
      binding: "ASSISTANT",
      service: ASSISTANT_WORKER_NAME,
    })],
    vars: Object.freeze({
      TARGET_WORKER_NAME: ASSISTANT_WORKER_NAME,
      TARGET_VERSION_ID: targetVersionId,
      APPROVED_ORIGIN: APPROVED_ORIGINS[0],
      OWNER_TOKEN_SHA256: ownerTokenHash,
    }),
    observability: Object.freeze({ enabled: true, head_sampling_rate: 1 }),
  });
}

function appendOutput(name, value) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (outputPath) fs.appendFileSync(outputPath, `${name}=${value}\n`);
}

function appendSummary(lines) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) fs.appendFileSync(summaryPath, `${lines.join("\n")}\n`);
}

async function waitForGateway(target, input = {}) {
  const fetchImpl = typeof input.fetchImpl === "function" ? input.fetchImpl : fetch;
  const sleepImpl = typeof input.sleepImpl === "function" ? input.sleepImpl : sleep;
  const attempts = Number.isInteger(input.attempts) ? input.attempts : ROUTE_ATTEMPTS;
  const delayMs = Number.isInteger(input.delayMs) ? input.delayMs : ROUTE_DELAY_MS;
  let lastStatus = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImpl(`${target}/?readiness=${attempt}`, {
        headers: { "cache-control": "no-store" },
      });
      lastStatus = response.status;
      if (
        response.status === 200
        && response.headers.get("x-evenai-owner-test-gateway") === GATEWAY_WORKER_NAME
      ) {
        return true;
      }
    } catch {
      lastStatus = "network-error";
    }
    if (attempt < attempts && delayMs > 0) await sleepImpl(delayMs);
  }
  throw new Error(`owner canary test route did not become ready; last status=${lastStatus}`);
}

export async function deployOwnerCanaryTest(input = {}) {
  const cloudflareImpl = typeof input.cloudflareImpl === "function" ? input.cloudflareImpl : cloudflare;
  const deployments = await cloudflareImpl(
    `/workers/scripts/${ASSISTANT_WORKER_NAME}/deployments`,
  );
  const baseline = activationBaseline(deployments);
  if (baseline.mode !== "bounded-canary" || !baseline.canaryVersionId) {
    throw new Error("owner testing requires the exact active 95/5 protected canary");
  }

  const canaryVersionId = validVersionId(baseline.canaryVersionId, "canaryVersionId");
  const versionDetails = await cloudflareImpl(
    `/workers/scripts/${ASSISTANT_WORKER_NAME}/versions/${canaryVersionId}`,
  );
  verifyEnabledCanaryVersion(versionDetails, canaryVersionId);

  const config = createOwnerCanaryConfig({ targetVersionId: canaryVersionId });
  fs.writeFileSync(GENERATED_CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`);
  fs.rmSync(WRANGLER_OUTPUT_PATH, { force: true });

  try {
    const deployImpl = typeof input.deployImpl === "function"
      ? input.deployImpl
      : () => wrangler(["deploy", "--config", GENERATED_CONFIG_PATH], {
        WRANGLER_OUTPUT_FILE_PATH: WRANGLER_OUTPUT_PATH,
      });
    await deployImpl({ config, configPath: GENERATED_CONFIG_PATH });

    let target;
    if (typeof input.target === "string" && input.target.trim()) {
      target = input.target.trim().replace(/\/$/, "");
    } else {
      const deployRecord = parseWorkerDeployRecord(
        fs.readFileSync(WRANGLER_OUTPUT_PATH, "utf8"),
        GATEWAY_WORKER_NAME,
      );
      target = deployRecord.targets[0].replace(/\/$/, "");
    }

    await waitForGateway(target, input);
    appendOutput("test_url", target);
    appendOutput("target_version_id", canaryVersionId);
    appendSummary([
      "## Protected owner canary test",
      "",
      `- Test URL: ${target}`,
      `- Exact canary version: \`${canaryVersionId}\``,
      "- Authentication: private owner token required",
      "- Public rollout remains fixed at 95% disabled / 5% canary",
      "- Automatic promotion remains prohibited",
    ]);
    console.log(`PASS: protected owner canary test gateway deployed at ${target}.`);
    console.log(`PASS: gateway pinned to exact canary version ${canaryVersionId}.`);
    return Object.freeze({ target, canaryVersionId });
  } finally {
    fs.rmSync(GENERATED_CONFIG_PATH, { force: true });
    fs.rmSync(WRANGLER_OUTPUT_PATH, { force: true });
  }
}

export async function removeOwnerCanaryTest(input = {}) {
  const cloudflareImpl = typeof input.cloudflareImpl === "function" ? input.cloudflareImpl : cloudflare;
  await cloudflareImpl(`/workers/scripts/${GATEWAY_WORKER_NAME}`, {
    method: "DELETE",
    allowNotFound: true,
  });
  appendSummary([
    "## Protected owner canary test",
    "",
    "- Gateway removed",
    "- The production assistant 95/5 deployment was not changed",
  ]);
  console.log("PASS: protected owner canary test gateway removed.");
  return true;
}

async function main() {
  required("CLOUDFLARE_API_TOKEN");
  required("CLOUDFLARE_ACCOUNT_ID");
  if (process.argv.includes("--deploy")) return deployOwnerCanaryTest();
  if (process.argv.includes("--remove")) return removeOwnerCanaryTest();
  throw new Error("--deploy or --remove is required");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`FAIL: ${error.message}`);
    process.exitCode = 1;
  });
}
