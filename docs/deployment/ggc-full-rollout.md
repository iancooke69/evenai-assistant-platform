# GetGasCert assistant full rollout

This operation promotes the exact active enabled canary from 5% to 100% after explicit owner authorization.

## Authorization

The repository contains a one-operation authorization record at:

`deployment-authorizations/ggc-full-rollout-v1.json`

The authorization records the owner's instruction to expose the assistant at 100% for live testing before the website has an expected public audience. It does not create a reusable automatic-promotion policy.

## Required starting state

The workflow fails closed unless Cloudflare is serving exactly:

- disabled stable version: 95%;
- enabled canary version: 5%.

Before changing traffic it verifies:

1. the 95% version is disabled and has an empty origin list;
2. the 5% version is enabled;
3. the enabled version contains exactly the approved GetGasCert origins;
4. the enabled version contains the required rate-limiter binding;
5. the repository test suite passes.

## Promotion

The workflow deploys the already verified enabled canary version at 100%. It does not upload a replacement application version and does not modify the assistant knowledge base.

After promotion it requires:

- one active Worker version at exactly 100%;
- the exact previously identified canary version ID;
- enabled bindings and exact approved origins still present;
- three successful public application probes;
- HTTP 200, correct CORS, correct service identity and exact version identity;
- an assistant result in each probe.

## Rollback

A plan containing the original disabled stable version ID is written before traffic changes. Any workflow failure after that point automatically deploys the disabled stable version at 100%, re-reads the active deployment and verifies the disabled bindings.

The promotion and rollback evidence artifacts are retained for 90 days.

## Trigger

The workflow is triggered once when the authorization record is merged to `main`. A manual dispatch entry remains available for a failed transient attempt, but the executor will refuse to run unless the live starting state is still the exact 95/5 deployment.
