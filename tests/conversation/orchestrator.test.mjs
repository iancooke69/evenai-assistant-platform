import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { orchestrateTurn } from "../../packages/conversation-engine/index.mjs";

const loadJson = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));

const services = await loadJson("../../apps/ggc/knowledge/services.json");
const emergencyRules = await loadJson("../../apps/ggc/knowledge/emergency-rules.json");
const actions = [
  ...await loadJson("../../apps/ggc/knowledge/booking-actions.json"),
  ...await loadJson("../../apps/ggc/knowledge/escalation-actions.json"),
];

test("safety routing runs before normal knowledge retrieval", () => {
  const result = orchestrateTurn("I need a CP42 but I can smell gas", {
    records: services,
    emergencyRules,
    actions,
  });

  assert.equal(result.route, "emergency");
  assert.equal(result.blocked, true);
  assert.equal(result.matches.length, 0);
  assert.equal(result.ruleId, "suspected-gas-emergency");
});

test("approved service language routes to knowledge", () => {
  const result = orchestrateTurn("I need a landlord rental gas certificate", {
    records: services,
    emergencyRules,
    actions,
  });

  assert.equal(result.route, "knowledge");
  assert.equal(result.blocked, false);
  assert.equal(result.matches[0].record.id, "cp12");
});

test("unrelated input fails to an explicit unknown route", () => {
  const result = orchestrateTurn("Can you repair my bicycle?", {
    records: services,
    emergencyRules,
    actions,
    minimumScore: 8,
  });

  assert.equal(result.route, "unknown");
  assert.equal(result.reason, "no-approved-knowledge");
  assert.deepEqual(result.matches, []);
});

test("empty input is blocked without invoking normal flow", () => {
  const result = orchestrateTurn("   ", {
    records: services,
    emergencyRules,
    actions,
  });

  assert.equal(result.route, "invalid");
  assert.equal(result.blocked, true);
  assert.equal(result.reason, "empty-input");
});
