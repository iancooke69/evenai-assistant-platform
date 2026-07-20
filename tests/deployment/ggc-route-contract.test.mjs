import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import worker from "../../apps/ggc/worker.mjs";

const VERSION_ID = "11111111-1111-4111-8111-111111111111";

test("configuration contains the production assistant route", () => {
  const config = JSON.parse(fs.readFileSync("wrangler.jsonc", "utf8"));
  assert.equal(config.workers_dev, false);
  assert.deepEqual(config.routes, [{
    pattern: "getgascert.com/api/assistant/*",
    zone_name: "getgascert.com",
  }]);
  assert.equal(config.version_metadata?.binding, "CF_VERSION_METADATA");
});

test("disabled responses include Worker identity", async () => {
  const response = await worker.fetch(
    new Request("https://getgascert.com/api/assistant/v1/assist", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "test" }),
    }),
    {
      ENABLE_PUBLIC_ASSISTANT: "false",
      ALLOWED_ORIGINS: "",
      CF_VERSION_METADATA: { id: VERSION_ID },
    },
    {},
  );

  assert.equal(response.status, 503);
  assert.equal(response.headers.get("x-evenai-service"), "evenai-ggc-assistant");
  assert.equal(response.headers.get("x-evenai-version-id"), VERSION_ID);
  assert.equal((await response.json()).error, "assistant_unavailable");
});
