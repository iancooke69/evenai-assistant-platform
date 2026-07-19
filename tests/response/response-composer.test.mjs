import test from "node:test";
import assert from "node:assert/strict";
import { composeResponse } from "../../packages/response-composer/index.mjs";

const service = {
  id: "cp42",
  name: "CP42 Commercial Catering Gas Safety Certificate",
  summary: "Commercial catering gas safety certification service.",
  status: "active",
  priceId: "price-cp42",
  bookingActionId: "book-cp42",
  source: { type: "owner-approved", reference: "catalogue" },
  approved: true,
};

const price = {
  id: "price-cp42",
  display: "£299",
  status: "active",
  source: { type: "owner-approved", reference: "pricing" },
  approved: true,
};

test("composes approved service and deterministic price", () => {
  const response = composeResponse(
    { route: "knowledge", matches: [{ record: service, score: 50 }] },
    { prices: [price], actions: [] },
  );

  assert.equal(response.type, "knowledge");
  assert.match(response.text, /£299/);
  assert.deepEqual(response.facts.map((fact) => fact.id), ["cp42", "price-cp42"]);
  assert.deepEqual(response.actions, []);
});

test("does not expose disabled or URL-less booking actions", () => {
  const response = composeResponse(
    { route: "knowledge", matches: [{ record: service, score: 50 }] },
    { prices: [price], actions: [{ id: "book-cp42", approved: true, enabled: false, url: null }] },
  );

  assert.deepEqual(response.actions, []);
});

test("emergency response does not resume normal service composition", () => {
  const response = composeResponse({
    route: "emergency",
    ruleId: "suspected-gas-emergency",
    response: "Stop the normal booking flow.",
    action: null,
  }, { prices: [price] });

  assert.equal(response.type, "emergency");
  assert.doesNotMatch(response.text, /CP42|£299/);
});

test("fails closed when an approved unique price cannot be verified", () => {
  const response = composeResponse(
    { route: "knowledge", matches: [{ record: service, score: 50 }] },
    { prices: [{ ...price, approved: false }], actions: [] },
  );

  assert.doesNotMatch(response.text, /£299/);
  assert.deepEqual(response.facts.map((fact) => fact.id), ["cp42"]);
});

test("returns an explicit unknown response for unsupported outcomes", () => {
  const response = composeResponse({ route: "unknown" });
  assert.equal(response.type, "unknown");
  assert.equal(response.actions.length, 0);
});
