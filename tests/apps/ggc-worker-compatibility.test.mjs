import test from "node:test";
import assert from "node:assert/strict";

import { loadGgcContext } from "../../apps/ggc/index.mjs";

test("GGC knowledge loads without filesystem access", async () => {
  const first = await loadGgcContext();
  const second = await loadGgcContext();

  assert.equal(first.services.length, 3);
  assert.equal(first.prices.length, 3);
  assert.equal(first.actions.length, 4);
  assert.equal(first.emergencyRules.length, 1);
  assert.notStrictEqual(first.services, second.services);
  assert.deepEqual(first, second);
});
