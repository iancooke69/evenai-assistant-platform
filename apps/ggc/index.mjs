import servicesData from "./knowledge/services.json" with { type: "json" };
import pricesData from "./knowledge/prices.json" with { type: "json" };
import bookingActionsData from "./knowledge/booking-actions.json" with { type: "json" };
import escalationActionsData from "./knowledge/escalation-actions.json" with { type: "json" };
import emergencyRulesData from "./knowledge/emergency-rules.json" with { type: "json" };
import { processAssistantTurn } from "../../packages/assistant-runtime/index.mjs";

function cloneArray(value, name) {
  if (!Array.isArray(value)) {
    throw new TypeError(`${name} must contain a JSON array`);
  }
  return structuredClone(value);
}

export async function loadGgcContext() {
  const services = cloneArray(servicesData, "services.json");
  const prices = cloneArray(pricesData, "prices.json");
  const bookingActions = cloneArray(bookingActionsData, "booking-actions.json");
  const escalationActions = cloneArray(escalationActionsData, "escalation-actions.json");
  const emergencyRules = cloneArray(emergencyRulesData, "emergency-rules.json");

  return Object.freeze({
    services,
    prices,
    actions: [...bookingActions, ...escalationActions],
    emergencyRules,
    minimumScore: 8,
    limit: 1,
  });
}

export async function askGgcAssistant(input, options = {}) {
  const context = options.context ?? await loadGgcContext();
  return processAssistantTurn(input, context);
}
