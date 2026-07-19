function normalise(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function matchSafetyRule(input, rules) {
  const query = normalise(input);
  if (!query) return null;

  const candidates = (Array.isArray(rules) ? rules : [])
    .filter((rule) => rule?.approved === true && rule?.stopNormalFlow === true)
    .flatMap((rule) => {
      const matchedTriggers = (Array.isArray(rule.triggers) ? rule.triggers : [])
        .map((trigger) => normalise(trigger))
        .filter((trigger) => trigger && query.includes(trigger));

      if (matchedTriggers.length === 0) return [];

      return [{
        rule,
        longestTriggerLength: Math.max(...matchedTriggers.map((trigger) => trigger.length)),
      }];
    })
    .sort((left, right) => {
      const priorityDifference = Number(left.rule.priority ?? Number.MAX_SAFE_INTEGER)
        - Number(right.rule.priority ?? Number.MAX_SAFE_INTEGER);
      if (priorityDifference !== 0) return priorityDifference;
      if (right.longestTriggerLength !== left.longestTriggerLength) {
        return right.longestTriggerLength - left.longestTriggerLength;
      }
      return String(left.rule.id).localeCompare(String(right.rule.id));
    });

  return candidates[0]?.rule ?? null;
}

export function routeForSafety(input, rules, actions = []) {
  const rule = matchSafetyRule(input, rules);
  if (!rule) {
    return {
      blocked: false,
      route: "normal",
      ruleId: null,
      response: null,
      action: null,
    };
  }

  const action = (Array.isArray(actions) ? actions : []).find(
    (candidate) => candidate?.id === rule.actionId && candidate?.approved === true,
  ) ?? null;

  return {
    blocked: true,
    route: "emergency",
    ruleId: rule.id,
    response: rule.response,
    action,
  };
}
