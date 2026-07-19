# Canary activation authorization

The `Authorize canary activation` workflow creates a bounded authorization record after the disabled Worker deployment has been verified. It does not change Cloudflare configuration, enable the assistant, configure browser origins, or expose traffic.

## Evidence chain

The workflow automatically finds the latest successful disabled deployment and the latest successful disabled-deployment verification. The verification evidence must refer to that latest deployment, contain no failed checks, and preserve the disabled live posture.

## Fixed limits

The authorization record allows a later protected activation stage to use no more than:

- 5 percent initial exposure;
- 30 minutes minimum observation;
- 10 requests per minute per client.

Automatic promotion and full public exposure remain prohibited.

## Required controls

A later activation stage must retain `workers_dev = false`, use approved HTTPS origins, require rate limiting and privacy-safe telemetry, perform post-activation verification, and use `disable-and-rollback` for any failure.

## Evidence boundary

The retained `canary-activation-authorization` artifact contains release and workflow identities, fixed limits, and control declarations only. It excludes origins, routes, bindings, credentials, prompts, responses, IP addresses, and customer data.

## Scope boundary

A passing authorization does not activate the assistant and does not permit promotion to full traffic. Activation and observation remain separate protected stages.
