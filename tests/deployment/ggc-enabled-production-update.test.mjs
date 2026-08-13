import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { oneVersionAt100 } from "../../scripts/update-ggc-enabled-production.mjs";

const versionId = "11111111-2222-3333-4444-555555555555";

test("records the exact one-shot enabled production update authorization", () => {
  const value = JSON.parse(fs.readFileSync(
    "deployment-authorizations/ggc-enabled-production-update-2026-08-13.json",
    "utf8",
  ));
  assert.equal(value.schemaVersion, 1);
  assert.equal(value.decision, "ggc-enabled-production-update-authorized");
  assert.equal(value.authorizedBy, "Ian Cooke");
  assert.equal(value.targetWorker, "evenai-ggc-assistant");
  assert.equal(value.requiredStartingState, "one-enabled-version-at-100-percent");
  assert.equal(value.targetExposurePercent, 100);
  assert.equal(value.rollbackToCurrentEnabledVersionRequired, true);
  assert.equal(value.automaticFutureUpdatesAuthorized, false);
  assert.ok(String(value.rationale).length > 40);
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
