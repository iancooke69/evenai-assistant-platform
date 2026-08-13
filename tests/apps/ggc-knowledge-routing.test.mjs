import test from "node:test";
import assert from "node:assert/strict";

import { askGgcAssistant } from "../../apps/ggc/index.mjs";

const cases = [
  {
    question: "How much is a CP42 certificate?",
    expectedId: "cp42",
    expectedText: "£249",
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
    question: "I operate an LPG mobile catering trailer. Which gas certificate do I need?",
    expectedId: "cp44",
    expectedText: "£199",
  },
  {
    question: "I am a landlord with a residential rental property. Which gas certificate do I need?",
    expectedId: "cp12",
    expectedText: "£119",
  },
  {
    question: "Which areas do GetGasCert cover?",
    expectedId: "coverage-east-anglia",
    expectedText: "Suffolk",
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
    const result = await askGgcAssistant(item.question, { websiteFallback: false });

    assert.equal(result.route, "knowledge");
    assert.equal(result.response.type, "knowledge");
    assert.match(result.response.text, new RegExp(item.expectedText, "i"));
    assert.deepEqual(result.diagnostics.matchedRecordIds, [item.expectedId]);
  });
}

test("uses only the customer question from the website knowledge envelope", async () => {
  const result = await askGgcAssistant([
    "Use WEBSITE EXCERPTS as GetGasCert's current source of truth.",
    "",
    "CUSTOMER QUESTION:",
    "I operate an LPG mobile catering trailer. Which gas certificate do I need?",
    "",
    "WEBSITE EXCERPTS:",
    "A fixed commercial kitchen uses CP42. This unrelated excerpt also mentions restaurants and commercial kitchens.",
  ].join("\n"), { websiteFallback: false });

  assert.equal(result.route, "knowledge");
  assert.deepEqual(result.diagnostics.matchedRecordIds, ["cp44"]);
  assert.match(result.response.text, /CP44/i);
  assert.match(result.response.text, /£199/);
});

test("returns all requested current certificate prices in one answer", async () => {
  const result = await askGgcAssistant("How much are CP12, CP42 and CP44?", { websiteFallback: false });
  assert.equal(result.route, "knowledge");
  assert.match(result.response.text, /CP12: £119/);
  assert.match(result.response.text, /CP42: £249/);
  assert.match(result.response.text, /CP44: £199/);
});

test("uses the public website corpus as a fallback for broader website questions", async () => {
  const corpus = {
    chunks: [
      {
        id: "page:/refund-cancellation-policy:1",
        url: "https://getgascert.com/refund-cancellation-policy",
        title: "Refund and cancellation policy",
        text: "Bookings are subject to the published refund and cancellation policy. Customers should review the current cancellation and rescheduling terms before booking.",
      },
    ],
  };
  const fetch = async () => new Response(JSON.stringify(corpus), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

  const result = await askGgcAssistant("What is your refund and cancellation policy?", { fetch });
  assert.equal(result.route, "website-knowledge");
  assert.match(result.response.text, /refund and cancellation policy/i);
  assert.equal(result.response.facts[0].source.url, "https://getgascert.com/refund-cancellation-policy");
});
