import test from "node:test";
import assert from "node:assert/strict";
import { askGgcAssistant, loadGgcContext } from "../../apps/ggc/index.mjs";

test("loads the approved GGC reference context", async () => {
  const context = await loadGgcContext();
  assert.equal(context.services.length, 3);
  assert.equal(context.prices.length, 3);
  assert.equal(context.emergencyRules.length, 1);
  assert.ok(context.actions.length >= 2);
  assert.equal(Object.isFrozen(context), true);
});

test("answers a CP44 enquiry using the approved reference data", async () => {
  const result = await askGgcAssistant("How much is a CP44 certificate?", { websiteFallback: false });
  assert.equal(result.route, "knowledge");
  assert.equal(result.response.type, "knowledge");
  assert.match(result.response.text, /£199/);
  assert.deepEqual(result.diagnostics.matchedRecordIds, ["cp44"]);
});

test("keeps unavailable booking actions hidden", async () => {
  const result = await askGgcAssistant("I need a landlord gas certificate", { websiteFallback: false });
  assert.equal(result.route, "knowledge");
  assert.match(result.response.text, /£119/);
  assert.deepEqual(result.response.actions, []);
});

test("routes gas emergency language before commercial intent", async () => {
  const result = await askGgcAssistant("I smell gas and also need a CP42", { websiteFallback: false });
  assert.equal(result.route, "emergency");
  assert.equal(result.blocked, true);
  assert.equal(result.response.type, "emergency");
  assert.match(result.response.text, /0800\s+111\s+999/);
  assert.doesNotMatch(result.response.text, /£249/);
});
