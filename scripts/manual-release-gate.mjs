import { writeFile } from "node:fs/promises";
import { createManualReleaseGate } from "../packages/manual-release-gate/index.mjs";

const evidence = createManualReleaseGate({
  releaseCommit: process.env.RELEASE_COMMIT,
  rollbackCommit: process.env.ROLLBACK_COMMIT,
  route: process.env.PRODUCTION_ROUTE,
  privacyNoticeUrl: process.env.PRIVACY_NOTICE_URL,
  allowedOrigins: process.env.ALLOWED_ORIGINS,
});

const outputPath = process.env.RELEASE_EVIDENCE_PATH || "release-gate-evidence.json";
await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
console.log(JSON.stringify(evidence));
