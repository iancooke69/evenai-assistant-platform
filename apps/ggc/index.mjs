import { readFile } from "node:fs/promises";
import { processAssistantTurn } from "../../packages/assistant-runtime/index.mjs";

const knowledgeRoot = new URL("./knowledge/", import.meta.url);

async function loadArray(filename) {
  const value = JSON.parse(await readFile(new URL(filename, knowledgeRoot), "utf8"));
  if (!Array.isArray(value)) {
    throw new TypeError(`${filename} must contain a JSON array`);
  }
  return value;
}

export async function loadGgcContext() {
  const [services, prices, bookingActions, escalationActions, emergencyRules] = await Promise.all([
    loadArray("services.json"),
    loadArray("prices.json"),
    loadArray("booking-actions.json"),
    loadArray("escalation-actions.json"),
    loadArray("emergency-rules.json"),
  ]);

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
