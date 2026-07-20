const FULL_SHA = /^[0-9a-f]{40}$/i;
const VERSION_ID = /^[0-9a-f-]{20,64}$/i;

export const CANARY_LIMITS = Object.freeze({
  maximumExposurePercent: 5,
  stableExposurePercent: 95,
  minimumObservationMinutes: 30,
  maximumRequestsPerMinutePerClient: 10,
});

export const APPROVED_ORIGINS = Object.freeze([
  "https://getgascert.com",
  "https://www.getgascert.com",
]);

function positiveRunId(value, name) {
  const normalized = String(value ?? "").trim();
  if (!/^[1-9][0-9]*$/.test(normalized)) {
    throw new TypeError(`${name} must be a positive GitHub Actions run ID`);
  }
  return normalized;
}

function fullSha(value, name) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!FULL_SHA.test(normalized)) throw new TypeError(`${name} must be a full commit SHA`);
  return normalized;
}

function versionId(value, name) {
  const normalized = String(value ?? "").trim();
  if (!VERSION_ID.test(normalized)) throw new TypeError(`${name} must be a Worker version ID`);
  return normalized;
}

function currentDeployment(payload) {
  if (payload?.success !== true) throw new Error("Cloudflare deployment query did not succeed");
  const deployments = payload?.result?.deployments;
  if (!Array.isArray(deployments) || deployments.length === 0) {
    throw new Error("Cloudflare returned no Worker deployments");
  }
  return deployments[0];
}

function binding(settings, name) {
  if (settings?.success !== true) throw new Error("Cloudflare settings query did not succeed");
  const bindings = settings?.result?.bindings;
  if (!Array.isArray(bindings)) throw new Error("Cloudflare settings bindings are unavailable");
  return bindings.find((candidate) => candidate?.name === name) ?? null;
}

export function validateCanaryAuthorization(evidence, latestDeploymentRunId) {
  const expectedDeploymentRunId = positiveRunId(latestDeploymentRunId, "latestDeploymentRunId");
  if (!evidence || typeof evidence !== "object") throw new TypeError("canary authorization evidence is required");
  if (
    evidence.schemaVersion !== 1
    || evidence.decision !== "canary-activation-authorized"
    || evidence.activationStatus !== "not-activated"
  ) {
    throw new Error("valid unused canary activation authorization is required");
  }
  if (positiveRunId(evidence.deploymentRunId, "evidence.deploymentRunId") !== expectedDeploymentRunId) {
    throw new Error("canary authorization is not for the latest disabled deployment");
  }
  const limits = evidence.limits ?? {};
  if (
    limits.maximumExposurePercent !== CANARY_LIMITS.maximumExposurePercent
    || limits.minimumObservationMinutes < CANARY_LIMITS.minimumObservationMinutes
    || limits.maximumRequestsPerMinutePerClient > CANARY_LIMITS.maximumRequestsPerMinutePerClient
  ) {
    throw new Error("canary authorization limits are outside the approved envelope");
  }
  const controls = evidence.controls ?? {};
  if (
    controls.publicAssistantCurrentlyEnabled !== false
    || controls.canaryActivationMayBePerformed !== true
    || controls.fullPublicActivationAuthorized !== false
    || controls.automaticPromotionProhibited !== true
    || controls.approvedOriginsRequired !== true
    || controls.rateLimiterRequired !== true
    || controls.telemetryRequired !== true
    || controls.postActivationVerificationRequired !== true
    || controls.rollbackRequiredOnAnyFailure !== true
  ) {
    throw new Error("canary authorization controls are incomplete");
  }
  return Object.freeze({
    releaseCommit: fullSha(evidence.releaseCommit, "evidence.releaseCommit"),
    deploymentRunId: expectedDeploymentRunId,
    authorizationRunId: positiveRunId(evidence.authorizationRunId, "evidence.authorizationRunId"),
  });
}

export function prepareCanaryActivation(input = {}) {
  const authorization = validateCanaryAuthorization(input.authorizationEvidence, input.latestDeploymentRunId);
  const deployment = currentDeployment(input.cloudflareDeployments);
  const versions = Array.isArray(deployment?.versions) ? deployment.versions : [];
  if (versions.length !== 1 || Number(versions[0]?.percentage) !== 100) {
    throw new Error("activation requires one currently deployed disabled version at 100 percent");
  }
  const stableVersionId = versionId(versions[0].version_id, "stableVersionId");

  const enabled = binding(input.cloudflareSettings, "ENABLE_PUBLIC_ASSISTANT");
  const origins = binding(input.cloudflareSettings, "ALLOWED_ORIGINS");
  if (enabled?.type !== "plain_text" || enabled?.text !== "false") {
    throw new Error("live Worker is not in the required disabled posture");
  }
  if (origins?.type !== "plain_text" || String(origins?.text ?? "").trim() !== "") {
    throw new Error("live Worker origins must be empty before canary activation");
  }

  const base = structuredClone(input.baseConfig ?? {});
  if (base.workers_dev !== false || base.vars?.ENABLE_PUBLIC_ASSISTANT !== "false") {
    throw new Error("release configuration must be disabled before canary preparation");
  }
  base.vars = {
    ...(base.vars ?? {}),
    ENABLE_PUBLIC_ASSISTANT: "true",
    ALLOWED_ORIGINS: APPROVED_ORIGINS.join(","),
    RATE_LIMIT_RETRY_AFTER_SECONDS: "60",
  };
  base.ratelimits = [{
    name: "RATE_LIMITER",
    namespace_id: "26071901",
    simple: {
      limit: CANARY_LIMITS.maximumRequestsPerMinutePerClient,
      period: 60,
    },
  }];
  base.observability = {
    enabled: true,
    head_sampling_rate: 1,
  };
  base.version_metadata = { binding: "CF_VERSION_METADATA" };

  const activationRunId = positiveRunId(input.activationRunId, "activationRunId");
  return Object.freeze({
    releaseCommit: authorization.releaseCommit,
    deploymentRunId: authorization.deploymentRunId,
    authorizationRunId: authorization.authorizationRunId,
    activationRunId,
    stableVersionId,
    canaryTag: `canary-${activationRunId}`,
    canaryConfig: Object.freeze(base),
  });
}

function versionTag(record) {
  return record?.tag
    ?? record?.metadata?.tag
    ?? record?.annotations?.["workers/tag"]
    ?? record?.annotations?.tag
    ?? null;
}

export function locateCanaryVersion(payload, tag) {
  const records = Array.isArray(payload) ? payload : payload?.result;
  if (!Array.isArray(records)) throw new Error("Worker versions list is invalid");
  const matching = records.filter((record) => versionTag(record) === tag);
  if (matching.length !== 1) throw new Error("exactly one uploaded canary version must match the activation tag");
  return versionId(matching[0]?.id ?? matching[0]?.version_id, "canaryVersionId");
}

export function verifyCanaryDeployment(payload, stableVersion, canaryVersion) {
  const stableVersionId = versionId(stableVersion, "stableVersionId");
  const canaryVersionId = versionId(canaryVersion, "canaryVersionId");
  const versions = currentDeployment(payload)?.versions;
  if (!Array.isArray(versions) || versions.length !== 2) throw new Error("active canary deployment must contain exactly two versions");
  const percentages = new Map(versions.map((item) => [item.version_id, Number(item.percentage)]));
  if (percentages.get(stableVersionId) !== CANARY_LIMITS.stableExposurePercent) {
    throw new Error("stable version is not fixed at 95 percent");
  }
  if (percentages.get(canaryVersionId) !== CANARY_LIMITS.maximumExposurePercent) {
    throw new Error("canary version is not fixed at 5 percent");
  }
  return true;
}

export function verifyCanaryProbe(probe = {}) {
  const status = Number(probe.status);
  if (status !== 200) {
    throw new Error("targeted canary application probe did not return HTTP 200");
  }
  if (probe.corsOrigin !== APPROVED_ORIGINS[0]) throw new Error("targeted canary probe did not return the approved CORS origin");
  const body = String(probe.body ?? "");
  if (/assistant_unavailable|rate-limiter-unavailable|origin_not_allowed/.test(body)) {
    throw new Error("targeted canary probe exposed a disabled or unprotected state");
  }
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error("targeted canary application probe did not return JSON");
  }
  if (!parsed?.result || typeof parsed.result !== "object") {
    throw new Error("targeted canary application probe did not return an assistant result");
  }
  return true;
}

export function createCanaryActivationEvidence(input = {}) {
  verifyCanaryDeployment(input.cloudflareDeployments, input.stableVersionId, input.canaryVersionId);
  verifyCanaryProbe(input.probe);
  return Object.freeze({
    schemaVersion: 1,
    decision: "retain-bounded-canary",
    activatedAt: new Date().toISOString(),
    releaseCommit: fullSha(input.releaseCommit, "releaseCommit"),
    deploymentRunId: positiveRunId(input.deploymentRunId, "deploymentRunId"),
    authorizationRunId: positiveRunId(input.authorizationRunId, "authorizationRunId"),
    activationRunId: positiveRunId(input.activationRunId, "activationRunId"),
    stableVersionId: versionId(input.stableVersionId, "stableVersionId"),
    canaryVersionId: versionId(input.canaryVersionId, "canaryVersionId"),
    exposure: Object.freeze({ stablePercent: 95, canaryPercent: 5 }),
    observation: Object.freeze({ minimumMinutes: 30, automaticPromotion: false }),
    controls: Object.freeze({
      approvedOriginsOnly: true,
      maximumRequestsPerMinutePerClient: 10,
      observabilityEnabled: true,
      rollbackRequiredOnFailure: true,
      fullPublicActivationAuthorized: false,
    }),
  });
}

export function createCanaryRollbackEvidence(input = {}) {
  return Object.freeze({
    schemaVersion: 1,
    decision: "canary-disabled-and-rolled-back",
    recordedAt: new Date().toISOString(),
    activationRunId: positiveRunId(input.activationRunId, "activationRunId"),
    stableVersionId: versionId(input.stableVersionId, "stableVersionId"),
    restoredStablePercent: 100,
    publicActivationAuthorized: false,
  });
}
