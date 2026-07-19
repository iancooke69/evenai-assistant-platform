function approvedActive(records) {
  return (Array.isArray(records) ? records : []).filter(
    (record) => record?.approved === true && (record.status === undefined || record.status === "active"),
  );
}

function uniqueById(id, records) {
  const matches = approvedActive(records).filter((record) => record.id === id);
  return matches.length === 1 ? matches[0] : null;
}

export function composeResponse(outcome, context = {}) {
  if (!outcome || typeof outcome !== "object") {
    return {
      type: "invalid",
      text: "Please enter a valid question.",
      facts: [],
      actions: [],
    };
  }

  if (outcome.route === "emergency") {
    const action = outcome.action?.approved === true && outcome.action?.enabled === true && outcome.action?.url
      ? outcome.action
      : null;

    return {
      type: "emergency",
      text: outcome.response || "This may require urgent human assistance.",
      facts: outcome.ruleId ? [{ kind: "safety-rule", id: outcome.ruleId }] : [],
      actions: action ? [{ id: action.id, label: action.label, url: action.url }] : [],
    };
  }

  if (outcome.route === "knowledge") {
    const service = outcome.matches?.[0]?.record ?? null;
    if (!service?.approved || service.status !== "active") {
      return {
        type: "unknown",
        text: "I could not verify an approved answer for that question.",
        facts: [],
        actions: [],
      };
    }

    const price = service.priceId ? uniqueById(service.priceId, context.prices) : null;
    const action = service.bookingActionId ? uniqueById(service.bookingActionId, context.actions) : null;
    const activeAction = action?.enabled === true && action?.url ? action : null;

    const textParts = [service.name, service.summary].filter(Boolean);
    if (price?.display) textParts.push(`Price: ${price.display}.`);

    return {
      type: "knowledge",
      text: textParts.join(" "),
      facts: [
        { kind: "service", id: service.id, source: service.source ?? null },
        ...(price ? [{ kind: "price", id: price.id, source: price.source ?? null }] : []),
      ],
      actions: activeAction ? [{ id: activeAction.id, label: activeAction.label, url: activeAction.url }] : [],
    };
  }

  if (outcome.route === "invalid") {
    return {
      type: "invalid",
      text: "Please enter a valid question.",
      facts: [],
      actions: [],
    };
  }

  return {
    type: "unknown",
    text: "I could not verify an approved answer for that question.",
    facts: [],
    actions: [],
  };
}
