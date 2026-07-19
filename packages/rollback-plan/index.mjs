const FULL_SHA = /^[a-f0-9]{40}$/;

function requireManifest(manifest) {
  if (!manifest || typeof manifest !== "object") {
    throw new TypeError("A release manifest is required.");
  }

  if (!FULL_SHA.test(manifest.releaseCommit ?? "")) {
    throw new Error("The release commit must be a full lowercase SHA-1.");
  }

  if (!FULL_SHA.test(manifest.rollbackCommit ?? "")) {
    throw new Error("The rollback commit must be a full lowercase SHA-1.");
  }

  if (manifest.releaseCommit === manifest.rollbackCommit) {
    throw new Error("Release and rollback commits must be different.");
  }

  if (manifest.publicAssistantEnabled !== true || manifest.workersDevDisabled !== true) {
    throw new Error("The release manifest does not declare the required production controls.");
  }
}

export function createRollbackPlan(manifest) {
  requireManifest(manifest);

  return Object.freeze({
    version: 1,
    releaseCommit: manifest.releaseCommit,
    rollbackCommit: manifest.rollbackCommit,
    triggerConditions: Object.freeze([
      "health-check-failure",
      "elevated-server-error-rate",
      "safety-routing-regression",
      "origin-policy-regression",
      "rate-limiter-regression",
    ]),
    steps: Object.freeze([
      Object.freeze({ order: 1, action: "disable-public-assistant" }),
      Object.freeze({ order: 2, action: "restore-rollback-commit" }),
      Object.freeze({ order: 3, action: "verify-health-endpoint" }),
      Object.freeze({ order: 4, action: "verify-assistant-remains-disabled" }),
      Object.freeze({ order: 5, action: "record-incident-outcome" }),
    ]),
    completionCriteria: Object.freeze([
      "health-endpoint-ok",
      "public-assistant-disabled",
      "rollback-commit-active",
      "incident-recorded",
    ]),
  });
}
