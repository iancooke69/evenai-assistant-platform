import test from "node:test";
import assert from "node:assert/strict";
import { processAssistantTurn } from "../../packages/assistant-runtime/index.mjs";

const context = {
  services: [
    {
      id: "cp42",
      name: "CP42 Commercial Catering Gas Safety Certificate",
      summary: "Commercial catering gas safety certification service.",
      status: "active",
      keywords: ["commercial kitchen", "catering", "gas certificate", "cp42"],
      priceId: "price-cp42",
      bookingActionId: "book-cp42",
      source: { type: "owner-approved", reference: "test catalogue" },
      approved: true,
    },
  ],
  prices: [
    {
      id: "price-cp42",
      serviceId: "cp42",
      display: "£299",
      status: "active",
      source: { type: "owner-approved", reference: "test pricing" },
      approved: true,
    },
  ],
  actions: [
    { id: "book-cp42", label: "Book CP42", status: "disabled", enabled: false, approved: true, url: null },
    { id: "emergency-human-escalation", label: "Get urgent help", status: "disabled", enabled: false, approved: true, url: null },
  ],
  emergencyRules: [
    {
      id: "suspected-gas-emergency",
      triggers: ["smell of gas", "smell gas", "carbon monoxide alarm"],
      response: "This may be a gas emergency. Stop the normal booking flow.",
      priority: 1,
      actionId: "emergency-human-escalation",
      stopNormalFlow: true,
      approved: true,
    },
  ],
};

test("returns a composed approved service response", () => {
  const result = processAssistantTurn("How much is a CP42?", context);
  assert.equal(result.route, "knowledge");
  assert.equal(result.blocked, false);
  assert.equal(result.response.type, "knowledge");
  assert.match(result.response.text, /£299/);
  assert.deepEqual(result.response.actions, []);
  assert.deepEqual(result.diagnostics.matchedRecordIds, ["cp42"]);
});

test("emergency routing overrides a simultaneous service enquiry", () => {
  const result = processAssistantTurn("I smell gas and need a CP42", context);
  assert.equal(result.route, "emergency");
  assert.equal(result.blocked, true);
  assert.equal(result.response.type, "emergency");
  assert.doesNotMatch(result.response.text, /£299/);
  assert.deepEqual(result.response.actions, []);
  assert.equal(result.diagnostics.ruleId, "suspected-gas-emergency");
});

test("unsupported questions fail without fabricated content", () => {
  const result = processAssistantTurn("Can you repair my refrigerator?", context);
  assert.equal(result.route, "unknown");
  assert.equal(result.response.type, "unknown");
  assert.deepEqual(result.response.facts, []);
  assert.deepEqual(result.response.actions, []);
});

test("empty input is blocked as invalid", () => {
  const result = processAssistantTurn("   ", context);
  assert.equal(result.route, "invalid");
  assert.equal(result.blocked, true);
  assert.equal(result.response.type, "invalid");
});
