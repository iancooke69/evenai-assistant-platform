import { assessDeploymentReadiness } from "../deployment-readiness/index.mjs";

const COMMIT_SHA = /^[0-9a-f]{40}$/;

function requiredString(value, name) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${name} is required`);
  }
  return value.trim();
}

function commitSha(value, name) {
  const normalized = requiredString(value, name).toLowerCase();
  if (!COMMIT_SHA.test(normalized)) {
    throw new TypeError(`${name} must be a full 40-character commit SHA`);
  }
  return normalized;
}

export function createReleaseManifest(input = {}) {
  const readiness = assessDeploymentReadiness(input);
  if (!readiness.ready) {
    const error = new Error("deployment is not ready");
    error.code = "deployment-not-ready";
    error.blockers = readiness.blockers;
    throw error;
  }

  const deployment = input.deployment ?? {};
  const release = input.release ?? {};
  const releaseCommit = commitSha(release.releaseCommit, "releaseCommit");
  const rollbackCommit = commitSha(deployment.rollbackCommit, "rollbackCommit");

  if (releaseCommit === rollbackCommit) {
    throw new TypeError("releaseCommit and rollbackCommit must differ");
  }

  return Object.freeze({
    schemaVersion: 1,
    service: requiredString(release.service, "service"),
    environment: "production",
    releaseCommit,
    rollbackCommit,
    route: requiredString(deployment.route, "route"),
    originCount: readiness.originCount,
    controls: Object.freeze({
      publicAssistantEnabled: true,
      workersDevDisabled: true,
      rateLimiterRequired: true,
      telemetryRequired: true,
      privacyNoticeRequired: true,
    }),
  });
}
