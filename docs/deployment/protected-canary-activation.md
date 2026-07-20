# Protected 5% canary activation

The `Activate protected 5 percent canary` workflow is the only approved mechanism for moving the GGC assistant from the verified disabled deployment into a bounded production canary.

## Preconditions

The workflow is zero-input and fail-closed. It automatically requires:

- the latest successful disabled Worker deployment;
- the latest passing disabled-deployment verification for that deployment;
- a new bounded authorization created inside the protected activation run;
- one actively deployed stable Worker version at 100%, or the exact recoverable 95% disabled stable / 5% canary split;
- `ENABLE_PUBLIC_ASSISTANT=false` and an empty origin list on the exact stable version;
- the Cloudflare account ID and API token already stored in the protected environment.

The posture check reads the active deployment first and then fetches that exact stable version's details. It does not use the script-level settings response, because that response can describe the most recently uploaded version even when that version is not serving traffic.

## Interrupted or repeated activation recovery

A previous activation can leave the exact protected 95/5 split in place, including when an operator starts another activation after a successful or interrupted run. The workflow now handles this state deterministically:

1. it accepts only the exact 95% stable / 5% canary deployment shape;
2. it verifies that the 95% version is still the disabled stable version;
3. it writes a rollback-capable recovery plan;
4. it restores that stable disabled version to 100% and verifies its disabled bindings;
5. it then performs one fresh authorized 5% activation.

Any other live traffic split is rejected without being modified. This recovery never promotes traffic and cannot widen canary exposure.

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
4. uses the same override or affinity key for one allowed-origin application request;
5. requires the application request to remain on the exact canary version and return HTTP 200, the approved CORS origin, and an assistant result;
6. writes the privacy-safe `canary-activation-evidence` artifact.

The routing probes use `OPTIONS`, which is handled before rate limiting and before assistant execution. They therefore validate routing without consuming the application rate-limit allowance or generating assistant responses. The final application check remains mandatory.

## Fail-closed rollback

Any failure after a recovery or activation plan is created triggers an immediate deployment of the stable disabled version at 100%. Rollback uses the original disabled Wrangler configuration, not the canary configuration. The workflow then fetches the restored stable version details and verifies both `ENABLE_PUBLIC_ASSISTANT=false` and an empty origin list before writing `canary-rollback-evidence`.

The workflow never promotes the canary above 5%. Promotion requires a separate observation and promotion authorization stage.
