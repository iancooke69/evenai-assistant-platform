import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { retrieveApproved, requireUniqueApprovedRecord } from "../../packages/knowledge-engine/index.mjs";

const services = JSON.parse(
  await readFile(new URL("../../apps/ggc/knowledge/services.json", import.meta.url), "utf8"),
);

test("retrieves CP42 deterministically by identifier", () => {
  const results = retrieveApproved("CP42", services);
  assert.equal(results[0]?.record.id, "cp42");
});

test("retrieves landlord service from approved keywords", () => {
  const results = retrieveApproved("landlord rental certificate", services);
  assert.equal(results[0]?.record.id, "cp12");
});

test("excludes unapproved and inactive records by default", () => {
  const records = [
    ...services,
    { id: "unapproved", name: "CP42", status: "active", approved: false },
    { id: "inactive", name: "CP42", status: "inactive", approved: true },
  ];
  const ids = retrieveApproved("CP42", records, { limit: 10 }).map(({ record }) => record.id);
  assert.ok(!ids.includes("unapproved"));
  assert.ok(!ids.includes("inactive"));
});

test("returns no result for an unrelated query", () => {
  assert.deepEqual(retrieveApproved("wedding photography", services), []);
});

test("requires one unique approved deterministic record", () => {
  assert.equal(requireUniqueApprovedRecord("cp44", services).id, "cp44");
  assert.throws(() => requireUniqueApprovedRecord("missing", services), /exactly one approved record/);
});
