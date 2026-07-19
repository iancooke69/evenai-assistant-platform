import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { matchSafetyRule, routeForSafety } from "../../packages/safety-engine/index.mjs";

const rules = JSON.parse(
  await readFile(new URL("../../apps/ggc/knowledge/emergency-rules.json", import.meta.url), "utf8"),
);
const actions = JSON.parse(
  await readFile(new URL("../../apps/ggc/knowledge/escalation-actions.json", import.meta.url), "utf8"),
);

test("suspected gas leak overrides the normal flow", () => {
  const result = routeForSafety("I think there is a suspected gas leak", rules, actions);
  assert.equal(result.blocked, true);
  assert.equal(result.route, "emergency");
  assert.equal(result.ruleId, "suspected-gas-emergency");
});

test("carbon monoxide alarm triggers emergency routing", () => {
  const rule = matchSafetyRule("Our carbon monoxide alarm is sounding", rules);
  assert.equal(rule?.id, "suspected-gas-emergency");
});

test("ordinary certificate enquiries remain in the normal flow", () => {
  const result = routeForSafety("How much is a CP42 certificate?", rules, actions);
  assert.deepEqual(result, {
    blocked: false,
    route: "normal",
    ruleId: null,
    response: null,
    action: null,
  });
});

test("unapproved rules cannot interrupt the normal flow", () => {
  const unapproved = [{
    id: "unsafe-draft",
    triggers: ["cp42"],
    response: "Draft",
    priority: 0,
    stopNormalFlow: true,
    approved: false,
  }];
  assert.equal(matchSafetyRule("cp42", unapproved), null);
});

test("an unavailable escalation action does not reactivate normal flow", () => {
  const result = routeForSafety("smell of gas", rules, []);
  assert.equal(result.blocked, true);
  assert.equal(result.action, null);
});
