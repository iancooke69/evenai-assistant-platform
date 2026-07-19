import { readFile } from 'node:fs/promises';

const root = new URL('../apps/ggc/knowledge/', import.meta.url);

async function load(name) {
  const value = JSON.parse(await readFile(new URL(name, root), 'utf8'));
  if (!Array.isArray(value)) throw new Error(`${name} must contain a JSON array`);
  return value;
}

function uniqueIds(records, name) {
  const seen = new Set();
  for (const record of records) {
    if (!record.id || typeof record.id !== 'string') throw new Error(`${name}: every record requires an id`);
    if (seen.has(record.id)) throw new Error(`${name}: duplicate id ${record.id}`);
    seen.add(record.id);
  }
  return seen;
}

const services = await load('services.json');
const prices = await load('prices.json');
const bookings = await load('booking-actions.json');
const escalations = await load('escalation-actions.json');
const coverage = await load('coverage.json');
const emergencyRules = await load('emergency-rules.json');

const serviceIds = uniqueIds(services, 'services');
const priceIds = uniqueIds(prices, 'prices');
const bookingIds = uniqueIds(bookings, 'booking-actions');
const escalationIds = uniqueIds(escalations, 'escalation-actions');
uniqueIds(coverage, 'coverage');
uniqueIds(emergencyRules, 'emergency-rules');

for (const service of services) {
  if (service.approved !== true) throw new Error(`service ${service.id} is not approved`);
  if (service.priceId && !priceIds.has(service.priceId)) throw new Error(`service ${service.id} has unknown priceId`);
  if (service.bookingActionId && !bookingIds.has(service.bookingActionId)) throw new Error(`service ${service.id} has unknown bookingActionId`);
}

for (const price of prices) {
  if (!serviceIds.has(price.serviceId)) throw new Error(`price ${price.id} has unknown serviceId`);
  if (price.approved !== true || price.status !== 'active') throw new Error(`price ${price.id} is not approved and active`);
  if (!Number.isInteger(price.amountMinor) || price.amountMinor < 0) throw new Error(`price ${price.id} has invalid amountMinor`);
}

for (const action of [...bookings, ...escalations]) {
  if (action.status === 'active' && (action.approved !== true || !action.url)) {
    throw new Error(`active action ${action.id} requires an approved URL`);
  }
}

for (const rule of emergencyRules) {
  if (rule.stopNormalFlow !== true) throw new Error(`emergency rule ${rule.id} must stop normal flow`);
  if (!escalationIds.has(rule.actionId)) throw new Error(`emergency rule ${rule.id} has unknown actionId`);
}

console.log(`PASS: ${services.length} services, ${prices.length} prices, ${coverage.length} coverage records and ${emergencyRules.length} emergency rules validated.`);
