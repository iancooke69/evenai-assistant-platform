import assert from "node:assert/strict";
import test from "node:test";
import { createReleaseManifest } from "../../packages/release-manifest/index.mjs";

function readyInput() {
  return {
    env: {
      ENABLE_PUBLIC_ASSISTANT: "true",
      ALLOWED_ORIGINS: "https://www.getgascert.com,https://getgascert.com",
      RATE_LIMITER: { limit: async () => ({ success: true }) },
      TELEMETRY: { write: async () => undefined },
    },
    deployment: {
      workersDev: false,
      route: "assistant.getgascert.com/*",
      privacyNoticeUrl: "https://www.getgascert.com/privacy",
      rollbackCommit: "1111111111111111111111111111111111111111",
    },
    release: {
      service: "evenai-ggc-assistant",
      releaseCommit: "2222222222222222222222222222222222222222",
    },
  };
}

test("refuses to create a manifest while deployment blockers remain", () => {
  assert.throws(
    () => createReleaseManifest({}),
    (error) => error.code === "deployment-not-ready" && error.blockers.includes("public-assistant-disabled"),
  );
});

test("creates a minimal immutable production release manifest", () => {
  const manifest = createReleaseManifest(readyInput());

  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.environment, "production");
  assert.equal(manifest.originCount, 2);
  assert.equal(manifest.controls.rateLimiterRequired, true);
  assert.equal(Object.isFrozen(manifest), true);
  assert.equal(Object.isFrozen(manifest.controls), true);
});

test("does not expose origin values, bindings, secrets or privacy URLs", () => {
  const input = readyInput();
  input.env.API_SECRET = "must-not-appear";
  const serialized = JSON.stringify(createReleaseManifest(input));

  assert.doesNotMatch(serialized, /getgascert\.com\/privacy/);
  assert.doesNotMatch(serialized, /must-not-appear/);
  assert.doesNotMatch(serialized, /ALLOWED_ORIGINS|RATE_LIMITER|TELEMETRY/);
});

test("requires distinct full release and rollback commit SHAs", () => {
  const same = readyInput();
  same.release.releaseCommit = same.deployment.rollbackCommit;
  assert.throws(() => createReleaseManifest(same), /must differ/);

  const abbreviated = readyInput();
  abbreviated.release.releaseCommit = "abc1234";
  assert.throws(() => createReleaseManifest(abbreviated), /40-character commit SHA/);
});
