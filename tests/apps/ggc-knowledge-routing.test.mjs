import test from "node:test";
import assert from "node:assert/strict";

import { askGgcAssistant } from "../../apps/ggc/index.mjs";

const cases = [
  {
    question: "How much is a CP42 certificate?",
    expectedId: "cp42",
    expectedText: "£299",
  },
  {
    question: "I run a pub and need a gas safety certificate",
    expectedId: "cp42",
    expectedText: "CP42",
  },
  {
    question: "I own a restaurant and need a gas certificate",
    expectedId: "cp42",
    expectedText: "CP42",
  },
  {
    question: "Can you inspect a mobile catering van?",
    expectedId: "cp44",
    expectedText: "CP44",
  },
  {
    question: "Do you cover Norwich?",
    expectedId: "coverage-east-anglia",
    expectedText: "Norwich",
  },
  {
    question: "How quickly can I book?",
    expectedId: "booking-availability",
    expectedText: "Availability depends",
  },
  {
    question: "Where are you based?",
    expectedId: "company-information",
    expectedText: "East Anglia",
  },
  {
    question: "Are you Gas Safe registered?",
    expectedId: "company-information",
    expectedText: "Gas Safe registered",
  },
];

for (const item of cases) {
  test(`GGC approved routing: ${item.question}`, async () => {
    const result = await askGgcAssistant(item.question);

    assert.equal(result.route, "knowledge");
    assert.equal(result.response.type, "knowledge");
    assert.match(result.response.text, new RegExp(item.expectedText, "i"));
    assert.deepEqual(result.diagnostics.matchedRecordIds, [item.expectedId]);
  });
}
