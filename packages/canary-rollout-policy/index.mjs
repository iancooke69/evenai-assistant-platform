const REQUIRED_CHECKS = Object.freeze([
  "health",
  "approved-origin",
  "knowledge-response",
  "emergency-precedence",
  "rate-limiting",
  "telemetry",
]);

function fullSha(value) {
  return typeof value === "string" && /^[a-f0-9]{40}$/i.test(value);
}

function positiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function validCanaryPercent(value) {
  return Number.isInteger(value) && value >= 1 && value <= 99;
}

export function createCanaryRolloutPlan(input = {}) {
  const releaseCommit = input.releaseCommit;
  const verification = input.verification ?? {};
  const canaryPercent = input.canaryPercent;
  const observationMinutes = input.observationMinutes;

  if (!fullSha(releaseCommit)) {
    throw new TypeError("releaseCommit must be a full 40-character commit SHA");
  }

  if (verification.releaseCommit !== releaseCommit || verification.decision !== "retain-release") {
    throw new Error("a retained post-deployment verification for the same release is required");
  }

  const checks = verification.checks ?? {};
  if (REQUIRED_CHECKS.some((check) => checks[check] !== "pass")) {
    throw new Error("all required verification checks must pass before canary rollout");
  }

  if (!validCanaryPercent(canaryPercent)) {
    throw new TypeError("canaryPercent must be an integer from 1 to 99");
  }

  if (!positiveInteger(observationMinutes)) {
    throw new TypeError("observationMinutes must be a positive integer");
  }

  return Object.freeze({
    version: 1,
    releaseCommit: releaseCommit.toLowerCase(),
    strategy: "verified-canary",
    stages: Object.freeze([canaryPercent, 100]),
    observationMinutes,
    promotionRule: "all-required-checks-pass",
    failureAction: "disable-and-rollback",
  });
}
