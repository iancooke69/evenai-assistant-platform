# GGC Assistant deployment readiness

The GetGasCert reference implementation must not be treated as production-ready until every readiness blocker is cleared.

## Required controls

- Public assistant activation is explicit.
- Browser origins are an exact HTTPS allowlist.
- `workers.dev` remains disabled.
- A custom public route is assigned.
- A functioning Cloudflare rate-limiter binding is present.
- A functioning privacy-safe telemetry binding is present.
- A published privacy notice is available.
- A tested rollback commit is recorded before deployment.

## Assessment contract

`assessDeploymentReadiness()` returns only:

- `ready`
- blocker identifiers
- the number of approved origins

It does not return origin values, binding objects, request data, secrets, customer information or message content.

## Current state

The repository remains intentionally undeployed. `wrangler.jsonc` keeps public access disabled, the origin allowlist empty and `workers_dev` disabled. Cloudflare bindings, routes and production metadata must be configured outside this repository before a production readiness assessment can pass.
