import { retrieveApproved } from "../knowledge-engine/index.mjs";
import { routeForSafety } from "../safety-engine/index.mjs";

export function orchestrateTurn(input, context = {}) {
  const message = String(input ?? "").trim();
  if (!message) {
    return {
      route: "invalid",
      blocked: true,
      reason: "empty-input",
      response: null,
      action: null,
      matches: [],
    };
  }

  const safety = routeForSafety(
    message,
    context.emergencyRules ?? [],
    context.actions ?? [],
  );

  if (safety.blocked) {
    return {
      route: "emergency",
      blocked: true,
      reason: "safety-rule",
      ruleId: safety.ruleId,
      response: safety.response,
      action: safety.action,
      matches: [],
    };
  }

  const matches = retrieveApproved(message, context.records ?? [], {
    limit: context.limit ?? 3,
    minimumScore: context.minimumScore ?? 1,
    fields: context.fields,
  });

  if (matches.length === 0) {
    return {
      route: "unknown",
      blocked: false,
      reason: "no-approved-knowledge",
      response: null,
      action: null,
      matches: [],
    };
  }

  return {
    route: "knowledge",
    blocked: false,
    reason: "approved-knowledge-match",
    response: null,
    action: null,
    matches,
  };
}
