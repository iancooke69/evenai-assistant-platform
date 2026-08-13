# GetGasCert chatbot — production release and rollback record

Date: 2026-08-13

## Final production state

The GetGasCert chatbot is deployed through the `evenai-ggc-assistant` Cloudflare Worker.

- Current production Worker version: `1891dcad-0ac9-4854-929f-1575275641ba`
- Traffic allocation: 100%
- Production deployment workflow run: `31740198131`
- Repository release commit used by the deployment: `a2b00675e63aaa5e33659775f2cc9adee6d3f58f`
- Validated application release commit: `2eabf200fbfbc8d54e94eb1030b9bd1b289fc4a3`
- Authorization PR: #58
- Code PR restoring the raw-question contract: #57
- Previous known-good enabled Worker version: `90863c7b-22f3-4886-aa17-7859de3b6ba7`
- Previous successful production update run: `31739496237`

The deployment run completed successfully. The automatic rollback step was skipped because the updated Worker passed production acceptance.

## Architecture

The production request path is:

1. The GetGasCert website sends the customer's raw question to `/api/assistant/v1/assist`.
2. The public Worker validates origin, rate limit and request size before assistant execution.
3. The HTTP contract accepts a maximum customer message length of 2,000 characters; 2,001 characters is rejected with HTTP 413 `message-too-long`.
4. Safety routing runs before normal service/knowledge routing.
5. Deterministic GGC records handle certificate classification, canonical prices, emergency guidance and other approved facts.
6. When deterministic records do not answer the question, the Worker retrieves from the generated public GetGasCert website knowledge corpus at `https://getgascert.com/assistant-knowledge.json`.
7. The browser does not prepend the old website-excerpt envelope; retrieval is server-side.

## Canonical facts validated in production

The guarded production acceptance suite verifies the current certificate prices and operational guidance:

- CP12: £119
- CP42: £249
- CP44: £199
- National Gas Emergency Service: 0800 111 999
- Service-area guidance includes Norfolk, Suffolk, Cambridgeshire and Essex
- broader website questions can route through `website-knowledge`

The final release also retains:

- exact approved browser-origin controls;
- the Cloudflare rate-limit binding;
- Worker version metadata/observability;
- fail-closed behaviour when mandatory controls are unavailable.

## Release evidence

GitHub Actions run `31740198131` performed the following sequence:

- full repository test suite — PASS;
- explicit one-shot deployment authorization — PASS;
- upload of Worker version `1891dcad-0ac9-4854-929f-1575275641ba` — PASS;
- verification of enabled production bindings — PASS;
- deployment of that exact version at 100% — PASS;
- production readiness/live answer checks — PASS;
- upload of `ggc-enabled-production-update-evidence` artifact — PASS;
- rollback step — SKIPPED because deployment passed.

The same run recorded the immediately preceding production state as one enabled Worker version at 100%:

`90863c7b-22f3-4886-aa17-7859de3b6ba7`

## Rollback marker

The canonical rollback identity is recorded separately in:

`docs/deployment/ggc-chatbot-rollback-marker-2026-08-13.json`

That marker is deliberately non-executing and does not authorize any deployment.

### Primary rollback target

If the current Worker develops a production regression and rollback is explicitly authorized, the first rollback target is the immediately preceding known-good enabled Worker version:

`90863c7b-22f3-4886-aa17-7859de3b6ba7`

Before traffic is moved, that version must still be independently verified as present and configured with the required enabled production controls.

After a rollback, verify at minimum:

- exactly one Worker version receives 100% traffic;
- the routed version ID equals the approved rollback target;
- the assistant remains enabled only for the approved origins;
- the rate limiter and Worker version metadata bindings remain present;
- CP12/CP42/CP44, emergency guidance and website-knowledge checks pass through the public route.

### Fail-closed fallback

If the primary enabled rollback target cannot be verified healthy, use the repository's existing `docs/rollback-plan.md` fail-safe contract rather than guessing another enabled version. That contract requires public-assistant disablement and restoration only from independently verified release identities.

## Change-control boundary

Neither this document nor the rollback marker authorizes a deployment, rollback, traffic change or future automatic update. Any rollback requires a new explicit owner authorization and the existing guarded production workflow or an equivalently verified procedure.
