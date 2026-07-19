import fs from "node:fs";
import { authorizeDisabledWorkerDeployment, createDisabledDeploymentEvidence } from "../packages/disabled-worker-deployment/index.mjs";

const evidencePath = process.env.RELEASE_GATE_EVIDENCE_PATH ?? "release-gate/manual-release-gate-evidence.json";
const outputPath = process.env.DEPLOYMENT_EVIDENCE_PATH ?? "disabled-deployment-evidence.json";
const releaseGateEvidence = JSON.parse(fs.readFileSync(evidencePath, "utf8"));

const input = {
  releaseCommit: process.env.RELEASE_COMMIT,
  gateRunId: process.env.RELEASE_GATE_RUN_ID,
  workflowRunId: process.env.GITHUB_RUN_ID,
  releaseGateEvidence,
};

if (process.argv.includes("--authorize")) {
  authorizeDisabledWorkerDeployment(input);
  console.log("PASS: disabled Worker deployment authorized.");
} else {
  const evidence = createDisabledDeploymentEvidence(input);
  fs.writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, { flag: "wx" });
  console.log(`PASS: wrote privacy-safe deployment evidence to ${outputPath}.`);
}
