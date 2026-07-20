import fs from "node:fs";
import { pathToFileURL } from "node:url";
import {
  createCanaryActivationEvidence,
  createCanaryRollbackEvidence,
  locateCanaryVersion,
  prepareCanaryActivation,
} from "../packages/canary-activation/index.mjs";

function readJson(path, label) {
  try {
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`Unable to read ${label}: ${error.message}`);
  }
}

function writeJson(path, value) {
  fs.writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function writeOutput(name, value) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) throw new Error("GITHUB_OUTPUT is required");
  fs.appendFileSync(outputPath, `${name}=${value}\n`);
}

function prepare() {
  const result = prepareCanaryActivation({
    authorizationEvidence: readJson(process.env.CANARY_AUTHORIZATION_PATH, "canary authorization evidence"),
    latestDeploymentRunId: process.env.LATEST_DEPLOYMENT_RUN_ID,
    activationRunId: process.env.ACTIVATION_RUN_ID,
    cloudflareDeployments: readJson(process.env.CLOUDFLARE_DEPLOYMENTS_PATH, "Cloudflare deployments"),
    cloudflareSettings: readJson(process.env.CLOUDFLARE_SETTINGS_PATH, "Cloudflare settings"),
    baseConfig: readJson(process.env.BASE_CONFIG_PATH, "release Wrangler configuration"),
  });
  writeJson(process.env.CANARY_CONFIG_PATH, result.canaryConfig);
  const plan = {
    schemaVersion: 1,
    releaseCommit: result.releaseCommit,
    deploymentRunId: result.deploymentRunId,
    authorizationRunId: result.authorizationRunId,
    activationRunId: result.activationRunId,
    stableVersionId: result.stableVersionId,
    canaryTag: result.canaryTag,
    canaryVersionId: null,
  };
  writeJson(process.env.CANARY_PLAN_PATH, plan);
  writeOutput("release_commit", result.releaseCommit);
  writeOutput("stable_version_id", result.stableVersionId);
  writeOutput("canary_tag", result.canaryTag);
  console.log(`PASS: prepared authorized 95/5 canary plan for release ${result.releaseCommit}.`);
}

function locate() {
  const plan = readJson(process.env.CANARY_PLAN_PATH, "canary plan");
  const canaryVersionId = locateCanaryVersion(
    readJson(process.env.CLOUDFLARE_VERSIONS_PATH, "Cloudflare versions"),
    plan.canaryTag,
  );
  plan.canaryVersionId = canaryVersionId;
  writeJson(process.env.CANARY_PLAN_PATH, plan);
  writeOutput("canary_version_id", canaryVersionId);
  console.log(`PASS: located uploaded canary version ${canaryVersionId}.`);
}

function finalize() {
  const plan = readJson(process.env.CANARY_PLAN_PATH, "canary plan");
  const evidence = createCanaryActivationEvidence({
    ...plan,
    cloudflareDeployments: readJson(process.env.CLOUDFLARE_POST_DEPLOYMENTS_PATH, "post-activation deployments"),
    probe: readJson(process.env.CANARY_PROBE_PATH, "targeted canary probe"),
  });
  writeJson(process.env.CANARY_ACTIVATION_EVIDENCE_PATH, evidence);
  console.log("PASS: verified and retained bounded 5 percent canary activation.");
}

function rollbackEvidence() {
  const plan = readJson(process.env.CANARY_PLAN_PATH, "canary plan");
  const evidence = createCanaryRollbackEvidence({
    activationRunId: plan.activationRunId,
    stableVersionId: plan.stableVersionId,
  });
  writeJson(process.env.CANARY_ROLLBACK_EVIDENCE_PATH, evidence);
  console.log("PASS: recorded fail-closed canary rollback evidence.");
}

async function main() {
  if (process.argv.includes("--prepare")) return prepare();
  if (process.argv.includes("--locate-version")) return locate();
  if (process.argv.includes("--finalize")) return finalize();
  if (process.argv.includes("--rollback-evidence")) return rollbackEvidence();
  throw new Error("one canary activation mode is required");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`FAIL: ${error.message}`);
    process.exitCode = 1;
  });
}
