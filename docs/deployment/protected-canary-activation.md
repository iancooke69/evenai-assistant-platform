# Protected 5% canary activation

The `Activate protected 5 percent canary` workflow is the only approved mechanism for moving the GGC assistant from the verified disabled deployment into a bounded production canary.

## Preconditions

The workflow is zero-input and fail-closed. It automatically requires:

- the latest successful disabled Worker deployment;
- the latest retained `canary-activation-authorization` artifact;
- authorization tied to that exact disabled deployment and release commit;
- one actively deployed stable Worker version at 100%;
- `ENABLE_PUBLIC_ASSISTANT=false` and an empty origin list on that exact deployed stable version;
- the Cloudflare account ID and API token already stored in the protected environment.

The posture check reads the active deployment first and then fetches that exact version's details. It does not use the script-level settings response, because that response can describe the most recently uploaded version even when that version is not serving traffic.

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
2. targets the canary version using Cloudflare's version-override header;
3. sends an allowed-origin application request;
4. requires HTTP 200, the approved CORS origin, and an assistant result;
5. writes the privacy-safe `canary-activation-evidence` artifact.

## Fail-closed rollback

Any failure after the plan is created triggers an immediate deployment of the stable disabled version at 100%. Rollback uses the original disabled Wrangler configuration, not the canary configuration. The workflow then fetches the restored stable version details and verifies both `ENABLE_PUBLIC_ASSISTANT=false` and an empty origin list before writing `canary-rollback-evidence`.

The workflow never promotes the canary above 5%. Promotion requires a separate observation and promotion authorization stage.
