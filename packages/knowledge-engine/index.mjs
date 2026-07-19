const DEFAULT_FIELDS = ["id", "name", "title", "summary", "question", "answer", "keywords"];

function normalise(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9£]+/g, " ")
    .trim();
}

function tokens(value) {
  return new Set(normalise(value).split(/\s+/).filter(Boolean));
}

function searchableText(record, fields = DEFAULT_FIELDS) {
  return fields
    .flatMap((field) => {
      const value = record[field];
      return Array.isArray(value) ? value : [value];
    })
    .filter((value) => value !== undefined && value !== null)
    .join(" ");
}

export function scoreRecord(query, record, options = {}) {
  const queryText = normalise(query);
  if (!queryText) return 0;

  const recordText = normalise(searchableText(record, options.fields));
  if (!recordText) return 0;

  let score = 0;
  if (recordText === queryText) score += 100;
  if (recordText.includes(queryText)) score += 30;

  const queryTokens = tokens(queryText);
  const recordTokens = tokens(recordText);
  for (const token of queryTokens) {
    if (recordTokens.has(token)) score += token.length >= 4 ? 8 : 3;
  }

  const id = normalise(record.id);
  if (id && queryTokens.has(id)) score += 50;

  return score;
}

export function retrieveApproved(query, records, options = {}) {
  if (!Array.isArray(records)) {
    throw new TypeError("records must be an array");
  }

  const limit = Number.isInteger(options.limit) && options.limit > 0 ? options.limit : 5;
  const minimumScore = Number.isFinite(options.minimumScore) ? options.minimumScore : 1;

  return records
    .filter((record) => record && record.approved === true)
    .filter((record) => options.includeInactive === true || record.status === undefined || record.status === "active")
    .map((record) => ({ record, score: scoreRecord(query, record, options) }))
    .filter(({ score }) => score >= minimumScore)
    .sort((left, right) => right.score - left.score || String(left.record.id).localeCompare(String(right.record.id)))
    .slice(0, limit);
}

export function requireUniqueApprovedRecord(id, records) {
  const matches = records.filter((record) => record?.id === id && record.approved === true);
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one approved record for ${id}; found ${matches.length}`);
  }
  return matches[0];
}
