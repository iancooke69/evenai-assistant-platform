const VERSION_ID_PATTERN = /^[0-9a-f-]{20,64}$/i;

export function parseVersionUploadRecord(text, expectedWorkerName) {
  const workerName = String(expectedWorkerName ?? "").trim();
  if (!workerName) throw new TypeError("expected Worker name is required");

  const lines = String(text ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) throw new Error("structured output is empty");

  const records = lines.map((line, index) => {
    try {
      return JSON.parse(line);
    } catch {
      throw new Error(`structured output line ${index + 1} is not valid JSON`);
    }
  });

  const matches = records.filter((record) => record?.type === "version-upload" && record?.worker_name === workerName);
  if (matches.length !== 1) throw new Error("exactly one matching version upload record is required");

  const versionId = String(matches[0]?.version_id ?? "").trim();
  if (!VERSION_ID_PATTERN.test(versionId)) throw new Error("version upload record does not contain a valid version ID");

  return Object.freeze({ workerName, versionId });
}
