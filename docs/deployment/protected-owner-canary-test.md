# Protected owner canary test

The `Manage protected owner canary test` workflow provides deterministic human testing of the exact enabled GetGasCert canary without increasing public exposure.

## Purpose

The public custom-domain route keeps the approved gradual deployment:

- disabled stable version: 95%;
- enabled canary version: 5%;
- automatic promotion: prohibited.

Normal website requests can therefore reach the disabled version. Repeated browser retries are not a reliable canary test because Cloudflare may retain routing affinity.

The owner test uses a separate temporary Worker named `evenai-ggc-owner-canary-test`. It does not replace the production route and does not modify the 95/5 deployment.

## Deployment controls

Before deployment, the workflow:

1. reads the active `evenai-ggc-assistant` deployment;
2. requires the exact 95% stable / 5% canary allocation;
3. identifies the active 5% version;
4. fetches that version's bindings;
5. requires `ENABLE_PUBLIC_ASSISTANT=true`;
6. requires exactly the two approved GetGasCert origins;
7. runs the complete repository test suite.

It then deploys a separate `workers.dev` gateway with a service binding to `evenai-ggc-assistant`. Every owner request applies a Cloudflare service-binding version override for the exact active canary version and rejects any response carrying a different version ID.

## Authentication

The browser page requires a private bearer token. The token:

- is entered manually by the owner;
- is stored only in the current browser tab's `sessionStorage`;
- is sent in the `Authorization` request header;
- is never placed in the URL;
- is not committed to the repository;
- is compared against a SHA-256 digest inside the gateway.

The deployed page can be viewed without the token, but assistant requests fail with HTTP 401 until the correct token is supplied.

## Rate-limit identity

The assistant rate limiter requires a client identity. The gateway therefore reads Cloudflare's incoming `CF-Connecting-IP` value and forwards that identity on the internal service-binding request using `X-Real-IP` and `CF-Connecting-IP`.

The owner bearer token is never forwarded to the assistant Worker. If Cloudflare does not supply a client identity, the gateway fails closed before calling the assistant.

## Operation

From GitHub Actions, run `Manage protected owner canary test` and select:

- `deploy` to create or update the protected gateway;
- `remove` to delete the gateway when testing is complete.

The deployment summary contains the generated test URL and the exact canary version ID. The owner token is supplied separately and must not be pasted into issues, workflow inputs, URLs or screenshots.

## Safety properties

The gateway:

- cannot promote or change production traffic;
- cannot select a version other than the active verified 5% canary;
- fails closed if the active deployment is not exactly 95/5;
- fails closed if canary bindings or approved origins differ;
- fails closed if the downstream response is not from the exact canary version;
- preserves the assistant's existing rate limiter and telemetry path;
- forwards only Cloudflare's client identity, not the owner token;
- uses `Cache-Control: no-store` and restrictive browser security headers.

Remove the gateway after owner testing. Removing it does not change the production assistant deployment.
