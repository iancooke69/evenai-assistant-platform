import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const workerPath = new URL("../../apps/ggc/owner-canary-test-worker.mjs", import.meta.url);

test("owner canary gateway preserves rate-limit identity without forwarding bearer credentials", () => {
  const source = fs.readFileSync(workerPath, "utf8");

  assert.match(source, /request\.headers\.get\("cf-connecting-ip"\)/);
  assert.match(source, /"x-real-ip": connectingIp/);
  assert.match(source, /"cf-connecting-ip": connectingIp/);
  assert.doesNotMatch(source, /authorization:\s*request\.headers\.get/);
  assert.match(source, /client_identity_unavailable/);
});
