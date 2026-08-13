import servicesData from "./knowledge/services.json" with { type: "json" };
import pricesData from "./knowledge/prices.json" with { type: "json" };
import bookingActionsData from "./knowledge/booking-actions.json" with { type: "json" };
import escalationActionsData from "./knowledge/escalation-actions.json" with { type: "json" };
import emergencyRulesData from "./knowledge/emergency-rules.json" with { type: "json" };
import faqsData from "./knowledge/faqs.json" with { type: "json" };
import { processAssistantTurn } from "../../packages/assistant-runtime/index.mjs";

const WEBSITE_KNOWLEDGE_URL = "https://getgascert.com/assistant-knowledge.json";
const WEBSITE_ANSWER_MAX_CHARS = 700;
const STOP_WORDS = new Set([
  "a", "about", "an", "and", "are", "as", "at", "be", "can", "do", "does",
  "for", "from", "how", "i", "in", "is", "it", "me", "my", "of", "on", "or",
  "please", "tell", "that", "the", "this", "to", "we", "what", "when", "where",
  "which", "with", "you", "your",
]);
const WEBSITE_ALIASES = {
  price: ["prices", "pricing", "cost", "costs", "fee", "fees"],
  prices: ["price", "pricing", "cost", "costs", "fee", "fees"],
  refund: ["refunds", "cancellation", "cancel", "reschedule"],
  cancellation: ["refund", "refunds", "cancel", "reschedule"],
  area: ["areas", "coverage", "cover", "location", "norfolk", "suffolk", "essex", "cambridgeshire"],
  areas: ["area", "coverage", "cover", "location"],
  emergency: ["urgent", "leak", "smell", "danger", "carbon", "monoxide"],
  cp12: ["landlord", "rental", "residential", "certificate"],
  cp42: ["commercial", "kitchen", "fixed", "restaurant", "cafe", "pub", "certificate"],
  cp44: ["mobile", "catering", "lpg", "trailer", "truck", "van", "certificate"],
  interlock: ["fan", "airflow", "solenoid", "shutdown"],
  ventilation: ["extraction", "airflow", "canopy", "fan"],
  lpg: ["cylinder", "regulator", "hose", "propane", "mobile"],
  technical: ["video", "call", "support", "diagnosis", "whatsapp"],
};

let websiteCorpusPromise;

function cloneArray(value, name) {
  if (!Array.isArray(value)) {
    throw new TypeError(`${name} must contain a JSON array`);
  }
  return structuredClone(value);
}

function normalise(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/£/g, " gbp ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function queryTerms(message) {
  const base = normalise(message)
    .split(" ")
    .filter((term) => term && !STOP_WORDS.has(term));
  const expanded = new Set(base);
  base.forEach((term) =>
    (WEBSITE_ALIASES[term] || []).forEach((alias) => expanded.add(alias)),
  );
  return [...expanded];
}

function extractCustomerQuestion(input) {
  const raw = String(input ?? "").trim();
  const questionMarker = "CUSTOMER QUESTION:";
  const contextMarker = "WEBSITE EXCERPTS:";
  const start = raw.indexOf(questionMarker);
  const end = raw.lastIndexOf(contextMarker);

  if (start < 0 || end <= start) return raw;
  const question = raw.slice(start + questionMarker.length, end).trim();
  return question || raw;
}

function priceRecordFor(serviceId, prices) {
  return prices.find(
    (price) => price?.approved === true && price?.status === "active" && price?.serviceId === serviceId,
  ) ?? null;
}

function multiPriceResponse(question, context) {
  if (!/(?:price|prices|pricing|cost|costs|how much|fee|fees)/i.test(question)) {
    return null;
  }

  const requested = [];
  for (const match of question.toUpperCase().matchAll(/\bCP(?:12|42|44)\b/g)) {
    if (!requested.includes(match[0])) requested.push(match[0]);
  }
  if (requested.length < 2) return null;

  const parts = [];
  const facts = [];
  for (const code of requested) {
    const serviceId = code.toLowerCase();
    const price = priceRecordFor(serviceId, context.prices);
    if (!price?.display) continue;
    parts.push(`${code}: ${price.display}`);
    facts.push({ kind: "price", id: price.id, source: price.source ?? null });
  }
  if (parts.length < 2) return null;

  return {
    version: "1.0",
    route: "knowledge",
    blocked: false,
    reason: "approved-multi-price-match",
    response: {
      type: "knowledge",
      text: `Current published certificate prices are ${parts.join("; ")}.`,
      facts,
      actions: [],
    },
    diagnostics: {
      ruleId: null,
      matchedRecordIds: requested.map((code) => code.toLowerCase()),
    },
  };
}

function websiteRoutePriority(pathname, terms) {
  const has = (...values) => values.some((value) => terms.includes(value));
  if (has("price", "prices", "pricing", "cost", "costs", "fee", "fees", "gbp") && pathname === "/prices") return 30;
  if (has("refund", "refunds", "cancellation", "cancel", "reschedule") && pathname === "/refund-cancellation-policy") return 30;
  if (has("area", "areas", "coverage", "cover", "location") && pathname === "/service-area") return 28;
  if (has("emergency", "urgent", "leak", "smell", "danger", "carbon", "monoxide") && pathname === "/emergency-call-outs") return 30;
  if (has("cp12", "landlord", "rental", "residential") && pathname === "/landlord-gas-safety-certificate") return 28;
  if (has("cp42", "restaurant", "cafe", "pub") && pathname === "/commercial-kitchen-gas-certification") return 28;
  if (has("cp44", "mobile", "trailer", "truck", "van") && pathname === "/mobile-catering-gas-certification") return 28;
  return 0;
}

function scoreWebsiteChunk(chunk, question, terms) {
  const pathname = new URL(chunk.url, WEBSITE_KNOWLEDGE_URL).pathname;
  const title = normalise(chunk.title);
  const path = normalise(pathname);
  const text = normalise(chunk.text);
  const phrase = normalise(question);
  let score = websiteRoutePriority(pathname, terms);

  if (phrase.length >= 8 && text.includes(phrase)) score += 30;
  for (const term of terms) {
    if (title.includes(term)) score += 8;
    if (path.includes(term)) score += 6;
    if (text.includes(term)) score += term.length >= 4 ? 2 : 1;
  }
  return score;
}

function sentenceScore(sentence, terms) {
  const text = normalise(sentence);
  let score = 0;
  for (const term of terms) {
    if (text.includes(term)) score += term.length >= 4 ? 3 : 1;
  }
  return score;
}

function websiteAnswerText(chunk, terms) {
  const parts = String(chunk.text ?? "")
    .replace(/([.!?])\s+/g, "$1\n")
    .split(/\n+/)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const ranked = parts
    .map((part, index) => ({ part, index, score: sentenceScore(part, terms) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, 4)
    .sort((a, b) => a.index - b.index);

  const selected = ranked.length ? ranked.map(({ part }) => part) : parts.slice(0, 2);
  let text = selected.join(" ").trim();
  if (text.length > WEBSITE_ANSWER_MAX_CHARS) {
    text = `${text.slice(0, WEBSITE_ANSWER_MAX_CHARS - 1).trim()}…`;
  }
  return text;
}

async function fetchWebsiteCorpus(fetchImpl) {
  if (typeof fetchImpl !== "function") return null;
  const response = await fetchImpl(WEBSITE_KNOWLEDGE_URL, {
    headers: { accept: "application/json" },
  });
  if (!response?.ok) return null;
  const corpus = await response.json();
  return Array.isArray(corpus?.chunks) ? corpus : null;
}

async function loadWebsiteCorpus(fetchImpl = globalThis.fetch) {
  if (fetchImpl !== globalThis.fetch) {
    try {
      return await fetchWebsiteCorpus(fetchImpl);
    } catch {
      return null;
    }
  }

  if (!websiteCorpusPromise) {
    websiteCorpusPromise = fetchWebsiteCorpus(fetchImpl).catch(() => {
      websiteCorpusPromise = undefined;
      return null;
    });
  }
  return websiteCorpusPromise;
}

async function websiteKnowledgeResponse(question, options = {}) {
  const corpus = await loadWebsiteCorpus(options.fetch ?? globalThis.fetch);
  if (!corpus) return null;

  const terms = queryTerms(question);
  if (terms.length === 0) return null;
  const best = corpus.chunks
    .map((chunk) => ({ chunk, score: scoreWebsiteChunk(chunk, question, terms) }))
    .sort((a, b) => b.score - a.score)[0];

  if (!best || best.score < 8) return null;
  const text = websiteAnswerText(best.chunk, terms);
  if (!text) return null;

  return {
    version: "1.0",
    route: "website-knowledge",
    blocked: false,
    reason: "public-website-knowledge-match",
    response: {
      type: "knowledge",
      text,
      facts: [{
        kind: "website",
        id: best.chunk.id ?? null,
        source: {
          type: "public-website",
          url: best.chunk.url,
          title: best.chunk.title,
        },
      }],
      actions: [],
    },
    diagnostics: {
      ruleId: null,
      matchedRecordIds: best.chunk.id ? [best.chunk.id] : [],
      websiteScore: best.score,
    },
  };
}

export async function loadGgcContext() {
  const services = cloneArray(servicesData, "services.json");
  const prices = cloneArray(pricesData, "prices.json");
  const bookingActions = cloneArray(bookingActionsData, "booking-actions.json");
  const escalationActions = cloneArray(escalationActionsData, "escalation-actions.json");
  const emergencyRules = cloneArray(emergencyRulesData, "emergency-rules.json");
  const faqs = cloneArray(faqsData, "faqs.json");

  return Object.freeze({
    services,
    faqs,
    records: [...services, ...faqs],
    prices,
    actions: [...bookingActions, ...escalationActions],
    emergencyRules,
    minimumScore: 16,
    limit: 1,
    fields: ["id", "name", "title", "summary", "question", "answer", "keywords", "topics"],
  });
}

export async function askGgcAssistant(input, options = {}) {
  const question = extractCustomerQuestion(input);
  const context = options.context ?? await loadGgcContext();
  const structured = processAssistantTurn(question, context);

  if (structured.route === "emergency") return structured;

  const multiPrice = multiPriceResponse(question, context);
  if (multiPrice) return multiPrice;

  if (structured.route !== "unknown") return structured;
  if (options.websiteFallback === false) return structured;

  return await websiteKnowledgeResponse(question, options) ?? structured;
}
