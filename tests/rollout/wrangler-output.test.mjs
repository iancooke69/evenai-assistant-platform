import test from "node:test";
import assert from "node:assert/strict";
import {
  parseVersionUploadRecord,
  parseWorkerDeployRecord,
} from "../../packages/wrangler-output/index.mjs";

const workerName = "evenai-ggc-assistant";
const versionId = "dc9c7ed0-c680-4b59-ae9b-60682a45169c";

test("extracts the exact version ID from one structured upload record", () => {
  const text = [
    JSON.stringify({ type: "wrangler-session", version: 1, wrangler_version: "4.112.0" }),
    JSON.stringify({
      type: "version-upload",
      version: 1,
      worker_name: workerName,
      version_id: versionId,
    }),
  ].join("\n");

  assert.deepEqual(parseVersionUploadRecord(text, workerName), {
    workerName,
    versionId,
  });
});

test("rejects an upload record for a different Worker", () => {
  const text = JSON.stringify({
    type: "version-upload",
    worker_name: "other-worker",
    version_id: versionId,
  });

  assert.throws(() => parseVersionUploadRecord(text, workerName), /exactly one matching/);
});

test("rejects ambiguous matching upload records", () => {
  const record = JSON.stringify({
    type: "version-upload",
    worker_name: workerName,
    version_id: versionId,
  });

  assert.throws(() => parseVersionUploadRecord(`${record}\n${record}`, workerName), /exactly one matching/);
});

test("rejects malformed structured output", () => {
  assert.throws(() => parseVersionUploadRecord("not-json", workerName), /not valid JSON/);
  assert.throws(() => parseVersionUploadRecord("", workerName), /empty/);
});

test("extracts a routable HTTPS target from one temporary Worker deploy record", () => {
  const probeName = "evenai-ggc-canary-probe-400";
  const text = [
    JSON.stringify({ type: "wrangler-session", version: 1, wrangler_version: "4.112.0" }),
    JSON.stringify({
      type: "deploy",
      version: 1,
      worker_name: probeName,
      targets: [`https://${probeName}.example.workers.dev`],
    }),
  ].join("\n");

  assert.deepEqual(parseWorkerDeployRecord(text, probeName), {
    workerName: probeName,
    targets: [`https://${probeName}.example.workers.dev`],
  });
});

test("rejects a temporary Worker deploy record without an HTTPS target", () => {
  const probeName = "evenai-ggc-canary-probe-400";
  const text = JSON.stringify({
    type: "deploy",
    worker_name: probeName,
    targets: ["http://unsafe.example.test"],
  });

  assert.throws(() => parseWorkerDeployRecord(text, probeName), /routable HTTPS target/);
});
