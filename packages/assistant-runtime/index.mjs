import { orchestrateTurn } from "../conversation-engine/index.mjs";
import { composeResponse } from "../response-composer/index.mjs";

export function processAssistantTurn(input, context = {}) {
  const outcome = orchestrateTurn(input, {
    emergencyRules: context.emergencyRules ?? [],
    actions: context.actions ?? [],
    records: context.records ?? context.services ?? [],
    limit: context.limit,
    minimumScore: context.minimumScore,
    fields: context.fields,
  });

  const response = composeResponse(outcome, {
    prices: context.prices ?? [],
    actions: context.actions ?? [],
  });

  return {
    version: "1.0",
    route: outcome.route,
    blocked: outcome.blocked === true,
    reason: outcome.reason ?? null,
    response,
    diagnostics: {
      ruleId: outcome.ruleId ?? null,
      matchedRecordIds: (outcome.matches ?? []).map(({ record }) => record?.id).filter(Boolean),
    },
  };
}
