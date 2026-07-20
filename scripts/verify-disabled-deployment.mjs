import fs from "node:fs";
import { verifyDisabledDeployment } from "../packages/disabled-deployment-verification/index.mjs";

function readJson(path, name) {
  try {
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`Unable to read ${name}: ${error.message}`);
  }
}

function requiredHttpsUrl(value) {
  let url;
  try {
    url = new URL(String(value ?? ""));
  } catch {
    throw new TypeError("PRODUCTION_PROBE_URL must be a valid HTTPS URL");
  }
  if (url.protocol !== "https:") {
    throw new TypeError("PRODUCTION_PROBE_URL must be a valid HTTPS URL");
  }
  return url;
}

async function probeProductionRoute(value) {
  const url = requiredHttpsUrl(value);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://disabled-verification.invalid",
      },
      body: JSON.stringify({ message: "disabled deployment verification" }),
      redirect: "follow",
      signal: controller.signal,
    });

    let body = null;
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.toLowerCase().includes("application/json")) {
      try {
        body = await response.json();
      } catch {
        body = null;
      }
    }

    return Object.freeze({
      status: response.status,
      assistantResponse: response.status === 200 && body && typeof body === "object" && "result" in body,
      corsOrigin: response.headers.get("access-control-allow-origin"),
    });
  } finally {
    clearTimeout(timeout);
  }
}

const deploymentEvidence = readJson(
  process.env.DEPLOYMENT_EVIDENCE_PATH ?? "deployment-evidence/disabled-deployment-evidence.json",
  "disabled deployment evidence",
);
const releaseConfig = readJson(
  process.env.RELEASE_CONFIG_PATH ?? "release/wrangler.jsonc",
  "release Wrangler configuration",
);
const cloudflareDeployments = readJson(
  process.env.CLOUDFLARE_DEPLOYMENTS_PATH ?? "cloudflare-deployments.json",
  "Cloudflare deployments response",
);
const cloudflareVersionDetails = readJson(
  process.env.CLOUDFLARE_VERSION_DETAILS_PATH ?? "cloudflare-version-details.json",
  "Cloudflare active version details response",
);
const probe = await probeProductionRoute(process.env.PRODUCTION_PROBE_URL);

const evidence = verifyDisabledDeployment({
  releaseCommit: process.env.RELEASE_COMMIT,
  deploymentRunId: process.env.DEPLOYMENT_RUN_ID,
  deploymentEvidence,
  releaseConfig,
  cloudflareDeployments,
  cloudflareVersionDetails,
  probe,
});

const outputPath = process.env.VERIFICATION_EVIDENCE_PATH ?? "disabled-deployment-verification-evidence.json";
fs.writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, { flag: "wx" });
console.log(`PASS: wrote privacy-safe disabled deployment verification evidence to ${outputPath}.`);

if (!evidence.verified) {
  console.error(`FAIL: disabled deployment verification failed: ${evidence.failedChecks.join(", ")}`);
  process.exitCode = 1;
}
