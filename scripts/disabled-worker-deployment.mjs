import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { authorizeDisabledWorkerDeployment, createDisabledDeploymentEvidence } from "../packages/disabled-worker-deployment/index.mjs";

const FULL_SHA = /(?:^|[^0-9a-f])([0-9a-f]{40})(?=$|[^0-9a-f])/gi;
const ACTIONS_RUN_URL = /\/actions\/runs\/([1-9][0-9]*)/i;
const LONG_INTEGER = /[1-9][0-9]{5,}/g;

export function normalizeReleaseCommit(value) {
  const input = String(value ?? "").trim();
  const matches = [];
  for (const match of input.matchAll(FULL_SHA)) matches.push(match[1].toLowerCase());
  const unique = [...new Set(matches)];
  if (unique.length !== 1) {
    throw new TypeError("release commit input must contain exactly one full 40-character commit SHA");
  }
  return unique[0];
}

export function normalizeReleaseGateRunId(value) {
  const input = String(value ?? "").trim();
  if (!input) throw new TypeError("release gate run ID is required");
  if (/^#[0-9]+$/.test(input)) {
    throw new TypeError("release gate run ID must be the numeric Actions run ID, not the visible workflow number");
  }

  const urlMatch = input.match(ACTIONS_RUN_URL);
  if (urlMatch) return urlMatch[1];

  const matches = [...new Set(input.match(LONG_INTEGER) ?? [])];
  if (matches.length !== 1) {
    throw new TypeError("release gate run ID input must contain exactly one numeric GitHub Actions run ID");
  }
  return matches[0];
}

function append(path, name, value) {
  if (!path) throw new Error(`${name} output file is required`);
  fs.appendFileSync(path, `${name}=${value}\n`);
}

function normalizeInputs() {
  const releaseCommit = normalizeReleaseCommit(process.env.RAW_RELEASE_COMMIT);
  const releaseGateRunId = normalizeReleaseGateRunId(process.env.RAW_RELEASE_GATE_RUN_ID);

  append(process.env.GITHUB_OUTPUT, "release_commit", releaseCommit);
  append(process.env.GITHUB_OUTPUT, "release_gate_run_id", releaseGateRunId);
  append(process.env.GITHUB_ENV, "RELEASE_COMMIT", releaseCommit);
  append(process.env.GITHUB_ENV, "RELEASE_GATE_RUN_ID", releaseGateRunId);

  console.log(`PASS: normalized release commit ${releaseCommit}.`);
  console.log(`PASS: normalized release gate run ID ${releaseGateRunId}.`);
}

function deploymentInput() {
  const evidencePath = process.env.RELEASE_GATE_EVIDENCE_PATH ?? "release-gate/manual-release-gate-evidence.json";
  const releaseGateEvidence = JSON.parse(fs.readFileSync(evidencePath, "utf8"));
  return {
    releaseCommit: process.env.RELEASE_COMMIT,
    gateRunId: process.env.RELEASE_GATE_RUN_ID,
    workflowRunId: process.env.GITHUB_RUN_ID,
    releaseGateEvidence,
  };
}

function main() {
  if (process.argv.includes("--normalize-inputs")) {
    normalizeInputs();
    return;
  }

  const input = deploymentInput();
  if (process.argv.includes("--authorize")) {
    authorizeDisabledWorkerDeployment(input);
    console.log("PASS: disabled Worker deployment authorized.");
    return;
  }

  const outputPath = process.env.DEPLOYMENT_EVIDENCE_PATH ?? "disabled-deployment-evidence.json";
  const evidence = createDisabledDeploymentEvidence(input);
  fs.writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, { flag: "wx" });
  console.log(`PASS: wrote privacy-safe deployment evidence to ${outputPath}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(`FAIL: ${error.message}`);
    process.exitCode = 1;
  }
}
