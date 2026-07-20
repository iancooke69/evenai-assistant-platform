# GetGasCert full rollout repair

## Incident

The owner-authorized 100% promotion completed successfully in GitHub Actions, but the public website continued to receive `assistant_unavailable` from the Worker. The browser widget and the Cloudflare dashboard confirmed that traffic reached a single Worker deployment at 100%, while the application response proved that the active runtime binding remained disabled.

The earlier promotion reused an existing enabled version ID while invoking `wrangler versions deploy` with the repository's disabled baseline configuration. The repair does not reuse that promotion path.

## Repair boundary

The one-shot repair workflow requires the live starting state to contain exactly one version at 100%. It then reads that version's bindings and refuses to proceed unless it is the disabled rollback posture:

- `ENABLE_PUBLIC_ASSISTANT=false`;
- empty `ALLOWED_ORIGINS`;
- one active version at 100%.

The current disabled version ID is recorded before any upload or traffic change.

## Fresh enabled version

The repair generates a separate Wrangler configuration from the disabled repository baseline. The generated configuration is required to contain:

- `ENABLE_PUBLIC_ASSISTANT=true`;
- exactly `https://getgascert.com` and `https://www.getgascert.com` as allowed origins;
- the native `RATE_LIMITER` binding at 10 requests per minute per client;
- operational version metadata;
- observability enabled at full sampling;
- `workers_dev=false` and preview URLs disabled;
- only the production `getgascert.com/api/assistant/*` route.

A fresh Worker version is uploaded with this generated enabled configuration. Its bindings are read back from Cloudflare and verified before traffic is changed.

## Deployment verification

The newly uploaded enabled version is deployed at 100% using the same generated enabled configuration. The workflow then requires:

1. exactly one active version at 100%;
2. the exact newly uploaded version ID;
3. the enabled binding, exact origin set, rate limiter and version metadata;
4. a successful public request to the production API route;
5. correct service and version identity headers;
6. HTTP 200, approved CORS and an assistant result;
7. two additional successful confirmations from the same exact version.

The public verification request asks for the CP42 price. A disabled response, limiter failure, wrong version, invalid CORS response or malformed assistant result fails the repair.

## Fail-closed rollback

If any operation after the plan is recorded fails, the workflow deploys the original disabled version back at 100% using the disabled repository configuration. It then reads the deployment and bindings again and requires the disabled posture before recording rollback evidence.

The repair does not weaken origin restrictions, rate limiting, telemetry or rollback controls. It does not create a reusable automatic-promotion policy.

## Trigger

The workflow runs once when `deployment-authorizations/ggc-full-rollout-repair-v1.json` is merged to `main`. A manual dispatch entry remains only for a transient failed attempt; the executor refuses to run after a healthy enabled version has replaced the disabled starting state.
