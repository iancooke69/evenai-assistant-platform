import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("repository tests cannot write synthetic owner-canary fixtures into the workflow summary", () => {
  const workflow = fs.readFileSync(
    new URL("../../.github/workflows/manage-owner-canary-test.yml", import.meta.url),
    "utf8",
  );

  assert.match(
    workflow,
    /run: GITHUB_STEP_SUMMARY= GITHUB_OUTPUT= npm test/,
  );
  assert.match(
    workflow,
    /run: node scripts\/manage-owner-canary-test\.mjs --deploy/,
  );
  assert.match(
    workflow,
    /run: node scripts\/manage-owner-canary-test\.mjs --remove/,
  );
});
