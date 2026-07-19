function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function configuredBinding(binding, method) {
  return binding && typeof binding[method] === "function";
}

function parseOrigins(value) {
  return String(value ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function validHttpsOrigin(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.origin === value && url.pathname === "/";
  } catch {
    return false;
  }
}

export function assessDeploymentReadiness(input = {}) {
  const env = input.env ?? {};
  const deployment = input.deployment ?? {};
  const origins = parseOrigins(env.ALLOWED_ORIGINS);
  const blockers = [];

  if (env.ENABLE_PUBLIC_ASSISTANT !== "true") blockers.push("public-assistant-disabled");
  if (origins.length === 0) blockers.push("allowed-origins-empty");
  if (origins.some((origin) => !validHttpsOrigin(origin))) blockers.push("allowed-origin-invalid");
  if (!configuredBinding(env.RATE_LIMITER, "limit")) blockers.push("rate-limiter-missing");
  if (!configuredBinding(env.TELEMETRY, "write")) blockers.push("telemetry-missing");
  if (deployment.workersDev !== false) blockers.push("workers-dev-not-disabled");
  if (!nonEmpty(deployment.route)) blockers.push("public-route-missing");
  if (!nonEmpty(deployment.privacyNoticeUrl)) blockers.push("privacy-notice-missing");
  if (!nonEmpty(deployment.rollbackCommit)) blockers.push("rollback-commit-missing");

  return Object.freeze({
    ready: blockers.length === 0,
    blockers: Object.freeze(blockers),
    originCount: origins.length,
  });
}
