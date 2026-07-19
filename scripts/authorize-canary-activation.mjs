import fs from "node:fs";
import { createCanaryActivationAuthorization } from "../packages/canary-activation-authorization/index.mjs";

function readJson(path, name) {
  try {
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`Unable to read ${name}: ${error.message}`);
  }
}

const verificationEvidencePath = process.env.VERIFICATION_EVIDENCE_PATH
  ?? "verification-evidence/disabled-deployment-verification-evidence.json";
const outputPath = process.env.CANARY_AUTHORIZATION_PATH
  ?? "canary-activation-authorization.json";

const verificationEvidence = readJson(
  verificationEvidencePath,
  "disabled deployment verification evidence",
);

const authorization = createCanaryActivationAuthorization({
  verificationEvidence,
  verificationRunId: process.env.VERIFICATION_RUN_ID,
  latestDeploymentRunId: process.env.LATEST_DEPLOYMENT_RUN_ID,
  authorizationRunId: process.env.GITHUB_RUN_ID,
});

fs.writeFileSync(outputPath, `${JSON.stringify(authorization, null, 2)}\n`, { flag: "wx" });
console.log(`PASS: wrote privacy-safe canary activation authorization to ${outputPath}.`);
