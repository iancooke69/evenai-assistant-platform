import assert from "node:assert/strict";
import test from "node:test";
import {
  oneVersionAt100,
  validateEnabledUpdateAuthorization,
} from "../../scripts/update-ggc-enabled-production.mjs";

const versionId = "11111111-2222-3333-4444-555555555555";

test("accepts the exact one-shot enabled production update authorization", () => {
  const result = validateEnabledUpdateAuthorization({
    schemaVersion: 1,
    decision: "ggc-enabled-production-update-authorized",
    authorizedBy: "Ian Cooke",
    targetWorker: "evenai-ggc-assistant",
    requiredStartingState: "one-enabled-version-at-100-percent",
    targetExposurePercent: 100,
    rollbackToCurrentEnabledVersionRequired: true,
    automaticFutureUpdatesAuthorized: false,
    rationale: "Validated GGC chatbot production update",
  });
  assert.equal(result.authorizedBy, "Ian Cooke");
});

test("rejects a disabled-baseline authorization", () => {
  assert.throws(() => validateEnabledUpdateAuthorization({
    schemaVersion: 1,
    decision: "ggc-enabled-production-update-authorized",
    authorizedBy: "Ian Cooke",
    targetWorker: "evenai-ggc-assistant",
    requiredStartingState: "one-disabled-version-at-100-percent",
    targetExposurePercent: 100,
    rollbackToCurrentEnabledVersionRequired: true,
    automaticFutureUpdatesAuthorized: false,
    rationale: "wrong state",
  }));
});

test("requires exactly one currently deployed version at 100 percent", () => {
  assert.equal(oneVersionAt100({
    success: true,
    result: { deployments: [{ versions: [{ version_id: versionId, percentage: 100 }] }] },
  }), versionId);

  assert.throws(() => oneVersionAt100({
    success: true,
    result: { deployments: [{ versions: [
      { version_id: versionId, percentage: 50 },
      { version_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", percentage: 50 },
    ] }] },
  }));
});
