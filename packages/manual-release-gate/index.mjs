import { createReleaseManifest } from "../release-manifest/index.mjs";

const FULL_SHA = /^[0-9a-f]{40}$/i;

function fullSha(value, name) {
  if (typeof value !== "string" || !FULL_SHA.test(value.trim())) {
    throw new TypeError(`${name} must be a full 40-character commit SHA`);
  }
  return value.trim().toLowerCase();
}

function required(value, name) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${name} is required`);
  }
  return value.trim();
}

export function createManualReleaseGate(input = {}) {
  const releaseCommit = fullSha(input.releaseCommit, "releaseCommit");
  const rollbackCommit = fullSha(input.rollbackCommit, "rollbackCommit");
  const route = required(input.route, "route");
  const privacyNoticeUrl = required(input.privacyNoticeUrl, "privacyNoticeUrl");
  const allowedOrigins = required(input.allowedOrigins, "allowedOrigins");

  const manifest = createReleaseManifest({
    env: {
      ENABLE_PUBLIC_ASSISTANT: "true",
      ALLOWED_ORIGINS: allowedOrigins,
      RATE_LIMITER: { limit() {} },
      TELEMETRY: { write() {} },
    },
    deployment: {
      workersDev: false,
      route,
      privacyNoticeUrl,
      rollbackCommit,
    },
    release: {
      service: "evenai-ggc-assistant",
      releaseCommit,
    },
  });

  return Object.freeze({
    schemaVersion: 1,
    decision: "release-authorized-for-disabled-deployment",
    generatedAt: new Date().toISOString(),
    releaseCommit: manifest.releaseCommit,
    rollbackCommit: manifest.rollbackCommit,
    service: manifest.service,
    environment: manifest.environment,
    originCount: manifest.originCount,
    controls: Object.freeze({
      fullRepositoryTestsRequired: true,
      deploymentRemainsDisabled: true,
      publicActivationProhibited: true,
      postDeploymentVerificationRequired: true,
      canaryRolloutRequired: true,
    }),
  });
}
