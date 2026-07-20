import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { validateCanaryAuthorization } from "../packages/canary-activation/index.mjs";

const ARTIFACT_NAME = "canary-activation-authorization";
const WORKFLOW_FILE = "authorize-canary-activation.yml";

async function apiJson(fetchImpl, url, token) {
  const response = await fetchImpl(url, {
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "x-github-api-version": "2022-11-28",
    },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`GitHub API request failed (${response.status}): ${body.slice(0, 300)}`);
  }
  return response.json();
}

export async function findLatestCanaryAuthorizationRun({ fetchImpl = fetch, repository, token }) {
  if (!repository || !repository.includes("/")) throw new TypeError("repository must be supplied as owner/name");
  if (!token) throw new TypeError("GitHub token is required");
  const apiRoot = `https://api.github.com/repos/${repository}`;

  for (let page = 1; page <= 5; page += 1) {
    const runsPayload = await apiJson(
      fetchImpl,
      `${apiRoot}/actions/workflows/${WORKFLOW_FILE}/runs?event=workflow_dispatch&status=success&branch=main&per_page=100&page=${page}`,
      token,
    );
    const runs = Array.isArray(runsPayload?.workflow_runs) ? runsPayload.workflow_runs : [];
    for (const run of runs) {
      if (!Number.isInteger(run?.id) || run.id <= 0 || run?.conclusion !== "success") continue;
      const artifactsPayload = await apiJson(
        fetchImpl,
        `${apiRoot}/actions/runs/${run.id}/artifacts?name=${ARTIFACT_NAME}&per_page=100`,
        token,
      );
      const artifacts = Array.isArray(artifactsPayload?.artifacts) ? artifactsPayload.artifacts : [];
      const artifact = artifacts.find((candidate) => (
        candidate?.name === ARTIFACT_NAME
        && candidate?.expired !== true
        && Number.isInteger(candidate?.id)
        && candidate.id > 0
      ));
      if (artifact) {
        return Object.freeze({ authorizationRunId: String(run.id), artifactId: String(artifact.id) });
      }
    }
    if (runs.length < 100) break;
  }
  throw new Error(`No successful ${WORKFLOW_FILE} run with retained ${ARTIFACT_NAME} evidence was found`);
}

export function readCanaryAuthorization(path, latestDeploymentRunId, expectedAuthorizationRunId) {
  let evidence;
  try {
    evidence = JSON.parse(fs.readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`Unable to read canary authorization evidence: ${error.message}`);
  }
  const validated = validateCanaryAuthorization(evidence, latestDeploymentRunId);
  const expected = String(expectedAuthorizationRunId ?? "").trim();
  if (!/^[1-9][0-9]*$/.test(expected)) throw new TypeError("authorization run ID must be a positive integer");
  if (validated.authorizationRunId !== expected) {
    throw new Error("canary authorization artifact does not match its workflow run");
  }
  return Object.freeze({ ...validated, evidence });
}

function writeOutput(name, value) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) throw new Error("GITHUB_OUTPUT is required");
  fs.appendFileSync(outputPath, `${name}=${value}\n`);
}

async function main() {
  if (process.argv.includes("--read-evidence")) {
    const result = readCanaryAuthorization(
      process.env.CANARY_AUTHORIZATION_PATH ?? "authorization-evidence/canary-activation-authorization.json",
      process.env.LATEST_DEPLOYMENT_RUN_ID,
      process.env.AUTHORIZATION_RUN_ID,
    );
    writeOutput("release_commit", result.releaseCommit);
    writeOutput("deployment_run_id", result.deploymentRunId);
    writeOutput("authorization_run_id", result.authorizationRunId);
    console.log(`PASS: validated canary authorization run ${result.authorizationRunId}.`);
    return;
  }
  const result = await findLatestCanaryAuthorizationRun({
    repository: process.env.GITHUB_REPOSITORY,
    token: process.env.GITHUB_TOKEN,
  });
  writeOutput("authorization_run_id", result.authorizationRunId);
  console.log(`PASS: selected canary authorization run ${result.authorizationRunId}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`FAIL: ${error.message}`);
    process.exitCode = 1;
  });
}
