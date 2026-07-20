# Protected 5% canary activation

The `Activate protected 5 percent canary` workflow is the only approved mechanism for moving the GGC assistant from the verified disabled deployment into a bounded production canary.

## Preconditions

The workflow is zero-input and fail-closed. It automatically requires:

- the latest successful disabled Worker deployment;
- the latest retained `canary-activation-authorization` artifact;
- authorization tied to that exact disabled deployment and release commit;
- a recoverable active deployment posture;
- `ENABLE_PUBLIC_ASSISTANT=false` and an empty origin list on the exact deployed stable version;
- the Cloudflare account ID and API token already stored in the protected environment.

The posture check reads the active deployment first and then fetches that exact version's details. It does not use the script-level settings response, because that response can describe the most recently uploaded version even when that version is not serving traffic.

## Preflight baseline normalization

A new activation normally starts from one verified disabled stable version at 100%. If a previous attempt left the exact protected 95% disabled stable / 5% canary split active, the workflow treats that split as recoverable state rather than entering a retry loop.

Before uploading a replacement canary, the workflow:

1. materializes the exact verified release configuration;
2. accepts only either one version at 100% or the exact 95/5 protected split;
3. fetches the 95% version and verifies `ENABLE_PUBLIC_ASSISTANT=false` with an empty origin list;
4. restores that disabled stable version to 100%;
5. re-reads the active deployment and bindings before continuing.

Any other allocation, or any 95% version that is not demonstrably disabled, fails closed without widening exposure.

## Activation boundary

The workflow uploads a new Worker version without changing traffic, then creates one gradual deployment:

- stable disabled version: 95%;
- enabled canary version: 5%;
- approved origins: `https://getgascert.com` and `https://www.getgascert.com` only;
- rate limit: 10 requests per minute per client key;
- Workers observability: enabled;
- automatic promotion: prohibited;
- full public activation: not authorized.

The exact authorized release source is materialized from Git history. The canary differs only in the approved bindings and canary controls.

## Post-activation verification

After the split is created, the workflow:

1. reads the active Cloudflare deployment and requires the exact 95/5 split;
2. attempts to route an `OPTIONS` probe directly to the canary with Cloudflare's version-override header;
3. if the override is not applied, searches bounded privacy-safe version-affinity keys against the live 5% split until one is confirmed twice on the exact canary version;
4. when public-route targeting is unavailable, deploys a short-lived token-protected probe Worker with a service binding to `evenai-ggc-assistant`;
5. applies the exact canary version override on the internal service-binding request and performs the mandatory allowed-origin assistant application request;
6. requires HTTP 200, the exact canary version ID, the approved CORS origin and an assistant result;
7. deletes the temporary probe Worker and writes the privacy-safe `canary-activation-evidence` artifact.

The direct routing probes use `OPTIONS`, which is handled before rate limiting and before assistant execution. The temporary service-binding fallback is used only after both public targeting mechanisms have failed. It is protected by a random per-run token, exists only for the duration of the probe and is deleted whether verification passes or fails.

## Fail-closed rollback

Any failure after the plan is created triggers an immediate deployment of the stable disabled version at 100%. Rollback uses the original disabled Wrangler configuration, not the canary configuration. The workflow then fetches the restored stable version details and verifies both `ENABLE_PUBLIC_ASSISTANT=false` and an empty origin list before writing `canary-rollback-evidence`.

The workflow never promotes the canary above 5%. Promotion requires a separate observation and promotion authorization stage.
