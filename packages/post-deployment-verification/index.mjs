const REQUIRED_CHECKS = Object.freeze([
  "health",
  "approved-origin",
  "knowledge-response",
  "emergency-precedence",
  "rate-limit",
  "telemetry",
]);

function validSha(value) {
  return typeof value === "string" && /^[a-f0-9]{40}$/u.test(value);
}

function validTimestamp(value) {
  if (typeof value !== "string" || value.length === 0) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

export function verifyPostDeployment(input = {}) {
  const releaseCommit = input.releaseCommit;
  const observedAt = input.observedAt;
  const checks = input.checks ?? {};

  if (!validSha(releaseCommit)) {
    throw new TypeError("releaseCommit must be a full lowercase 40-character commit SHA");
  }
  if (!validTimestamp(observedAt)) {
    throw new TypeError("observedAt must be an ISO-8601 UTC timestamp");
  }

  const failedChecks = REQUIRED_CHECKS.filter((name) => checks[name] !== true);

  return Object.freeze({
    verified: failedChecks.length === 0,
    releaseCommit,
    observedAt,
    requiredChecks: REQUIRED_CHECKS,
    failedChecks: Object.freeze(failedChecks),
    action: failedChecks.length === 0 ? "retain-release" : "disable-and-rollback",
  });
}
