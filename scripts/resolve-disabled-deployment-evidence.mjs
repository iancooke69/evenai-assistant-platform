import fs from "node:fs";
import { pathToFileURL } from "node:url";

const FULL_SHA = /^[0-9a-f]{40}$/i;
const ARTIFACT_NAME = "disabled-worker-deployment-evidence";
const WORKFLOW_FILE = "deploy-disabled-worker.yml";

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

export async function findLatestDisabledDeploymentRun({ fetchImpl = fetch, repository, token }) {
  if (!repository || !repository.includes("/")) {
    throw new TypeError("repository must be supplied as owner/name");
  }
  if (!token) {
    throw new TypeError("GitHub token is required");
  }

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
      const evidenceArtifact = artifacts.find((artifact) => (
        artifact?.name === ARTIFACT_NAME
        && artifact?.expired !== true
        && Number.isInteger(artifact?.id)
        && artifact.id > 0
      ));

      if (evidenceArtifact) {
        return Object.freeze({
          deploymentRunId: String(run.id),
          artifactId: String(evidenceArtifact.id),
        });
      }
    }

    if (runs.length < 100) break;
  }

  throw new Error(`No successful ${WORKFLOW_FILE} run with an unexpired ${ARTIFACT_NAME} artifact was found`);
}

export function readExactDeploymentEvidence(path, expectedRunId) {
  const runId = String(expectedRunId ?? "").trim();
  if (!/^[1-9][0-9]*$/.test(runId)) {
    throw new TypeError("expected deployment run ID must be a positive integer");
  }

  let evidence;
  try {
    evidence = JSON.parse(fs.readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`Unable to read disabled deployment evidence: ${error.message}`);
  }

  if (
    evidence?.schemaVersion !== 1
    || evidence?.decision !== "disabled-worker-deployment-authorized"
    || evidence?.deploymentStatus !== "deployed-disabled"
  ) {
    throw new Error("Downloaded artifact is not valid disabled deployment evidence");
  }

  if (String(evidence.workflowRunId ?? "").trim() !== runId) {
    throw new Error("Downloaded deployment evidence does not match its workflow run");
  }

  const releaseCommit = String(evidence.releaseCommit ?? "").trim().toLowerCase();
  if (!FULL_SHA.test(releaseCommit)) {
    throw new Error("Downloaded deployment evidence does not contain a full release commit SHA");
  }

  return Object.freeze({ releaseCommit, deploymentRunId: runId });
}

function writeOutput(name, value) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) throw new Error("GITHUB_OUTPUT is required");
  fs.appendFileSync(outputPath, `${name}=${value}\n`);
}

async function main() {
  if (process.argv.includes("--read-evidence")) {
    const result = readExactDeploymentEvidence(
      process.env.DEPLOYMENT_EVIDENCE_PATH ?? "deployment-evidence/disabled-deployment-evidence.json",
      process.env.DEPLOYMENT_RUN_ID,
    );
    writeOutput("release_commit", result.releaseCommit);
    console.log(`PASS: validated disabled deployment evidence for run ${result.deploymentRunId}.`);
    return;
  }

  const result = await findLatestDisabledDeploymentRun({
    repository: process.env.GITHUB_REPOSITORY,
    token: process.env.GITHUB_TOKEN,
  });
  writeOutput("deployment_run_id", result.deploymentRunId);
  console.log(`PASS: selected disabled deployment run ${result.deploymentRunId} with retained evidence.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`FAIL: ${error.message}`);
    process.exitCode = 1;
  });
}
