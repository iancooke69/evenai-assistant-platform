import fs from "node:fs";
import { pathToFileURL } from "node:url";

const FULL_SHA = /[0-9a-f]{40}/gi;
const ACTIONS_RUN_URL = /\/actions\/runs\/([1-9][0-9]*)/g;

function unique(values) {
  return [...new Set(values)];
}

export function normalizeReleaseCommit(value) {
  const matches = unique((String(value ?? "").match(FULL_SHA) ?? []).map((match) => match.toLowerCase()));
  if (matches.length !== 1) {
    throw new TypeError("release_commit must contain exactly one full 40-character commit SHA");
  }
  return matches[0];
}

export function normalizeDeploymentRunId(value) {
  const normalized = String(value ?? "").trim();
  if (/^[1-9][0-9]*$/.test(normalized)) return normalized;

  const matches = unique([...normalized.matchAll(ACTIONS_RUN_URL)].map((match) => match[1]));
  if (matches.length !== 1) {
    throw new TypeError("deployment_run_id must be a positive numeric run ID or a GitHub Actions run URL");
  }
  return matches[0];
}

function runCli() {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) throw new Error("GITHUB_OUTPUT is required");

  const releaseCommit = normalizeReleaseCommit(process.env.RAW_RELEASE_COMMIT);
  const deploymentRunId = normalizeDeploymentRunId(process.env.RAW_DEPLOYMENT_RUN_ID);

  fs.appendFileSync(
    outputPath,
    `release_commit=${releaseCommit}\ndeployment_run_id=${deploymentRunId}\n`,
    "utf8",
  );

  console.log(`PASS: normalized release ${releaseCommit.slice(0, 7)} and deployment run ${deploymentRunId}.`);
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (invokedPath === import.meta.url) runCli();
