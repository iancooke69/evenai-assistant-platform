import fs from "node:fs";
import { pathToFileURL } from "node:url";

async function main() {
  const probeUrl = String(process.env.CANARY_PROBE_URL ?? "").trim();
  const versionId = String(process.env.CANARY_VERSION_ID ?? "").trim();
  const outputPath = process.env.CANARY_PROBE_PATH ?? "canary-probe.json";
  if (!probeUrl.startsWith("https://")) throw new Error("CANARY_PROBE_URL must be HTTPS");
  if (!versionId) throw new Error("CANARY_VERSION_ID is required");

  const response = await fetch(probeUrl, {
    method: "POST",
    headers: {
      origin: "https://getgascert.com",
      "content-type": "application/json",
      "Cloudflare-Workers-Version-Overrides": `evenai-ggc-assistant="${versionId}"`,
    },
    body: JSON.stringify({ message: "Can you help?" }),
  });

  const result = {
    status: response.status,
    corsOrigin: response.headers.get("access-control-allow-origin"),
    body: (await response.text()).slice(0, 2000),
  };
  fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
  console.log(`PASS: captured targeted canary probe with HTTP ${response.status}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`FAIL: ${error.message}`);
    process.exitCode = 1;
  });
}
