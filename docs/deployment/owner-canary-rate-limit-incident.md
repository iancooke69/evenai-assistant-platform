# Owner canary rate-limit incident

## Symptom

The protected owner canary page reached the exact enabled Worker version but returned `The assistant rate limiter is unavailable.`

## Root cause

The owner gateway created a new service-binding request containing the approved origin, request ID and version override, but it did not preserve Cloudflare's client identity. The downstream assistant rate-limit policy therefore received no `CF-Connecting-IP` value and failed closed before invoking the assistant runtime.

## Resolution

The gateway now requires Cloudflare's incoming client address and forwards it on the internal request as `X-Real-IP` and `CF-Connecting-IP`. It continues to remove the owner bearer token and fails closed before the service binding if client identity is unavailable.

The production assistant deployment and its 95% disabled / 5% enabled allocation are not changed by this correction. Redeploy only the separate owner test gateway.
