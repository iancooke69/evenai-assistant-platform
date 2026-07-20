import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const workflowPath = ".github/workflows/activate-canary.yml";

test("releases the normalization worktree before protected activation", () => {
  const workflow = fs.readFileSync(workflowPath, "utf8");
  const normalizeIndex = workflow.indexOf("- name: Normalize disabled baseline before activation");
  const cleanupIndex = workflow.indexOf("- name: Release normalized deployment worktree");
  const activateIndex = workflow.indexOf("- name: Execute protected canary activation");

  assert.ok(normalizeIndex >= 0, "normalization step must exist");
  assert.ok(cleanupIndex > normalizeIndex, "worktree cleanup must run after normalization");
  assert.ok(activateIndex > cleanupIndex, "worktree cleanup must run before activation");

  const cleanupBlock = workflow.slice(cleanupIndex, activateIndex);
  assert.match(cleanupBlock, /git worktree remove --force release-source \|\| true/);
  assert.match(cleanupBlock, /rm -rf release-source/);
  assert.match(cleanupBlock, /git worktree prune/);
});
