const VERSION_ID_PATTERN = /^[0-9a-f-]{20,64}$/i;

function parseStructuredRecords(text) {
  const lines = String(text ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) throw new Error("structured output is empty");

  return lines.map((line, index) => {
    try {
      return JSON.parse(line);
    } catch {
      throw new Error(`structured output line ${index + 1} is not valid JSON`);
    }
  });
}

function requiredWorkerName(expectedWorkerName) {
  const workerName = String(expectedWorkerName ?? "").trim();
  if (!workerName) throw new TypeError("expected Worker name is required");
  return workerName;
}

export function parseVersionUploadRecord(text, expectedWorkerName) {
  const workerName = requiredWorkerName(expectedWorkerName);
  const records = parseStructuredRecords(text);
  const matches = records.filter((record) => record?.type === "version-upload" && record?.worker_name === workerName);
  if (matches.length !== 1) throw new Error("exactly one matching version upload record is required");

  const versionId = String(matches[0]?.version_id ?? "").trim();
  if (!VERSION_ID_PATTERN.test(versionId)) throw new Error("version upload record does not contain a valid version ID");

  return Object.freeze({ workerName, versionId });
}

export function parseWorkerDeployRecord(text, expectedWorkerName) {
  const workerName = requiredWorkerName(expectedWorkerName);
  const records = parseStructuredRecords(text);
  const matches = records.filter((record) => record?.type === "deploy" && record?.worker_name === workerName);
  if (matches.length !== 1) throw new Error("exactly one matching Worker deploy record is required");

  const targets = Array.isArray(matches[0]?.targets)
    ? matches[0].targets.map((target) => String(target ?? "").trim()).filter(Boolean)
    : [];
  const routableTargets = targets.filter((target) => {
    try {
      const url = new URL(target);
      return url.protocol === "https:" && Boolean(url.hostname);
    } catch {
      return false;
    }
  });
  if (routableTargets.length === 0) throw new Error("Worker deploy record does not contain a routable HTTPS target");

  return Object.freeze({ workerName, targets: Object.freeze(routableTargets) });
}
