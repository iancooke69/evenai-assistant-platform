# Canary rollout contract

The production assistant must not move directly from verified deployment to unrestricted public exposure without an explicit rollout plan.

## Preconditions

A rollout plan requires:

- a full 40-character release commit SHA;
- post-deployment verification for that exact release;
- a `retain-release` verification decision;
- passing health, origin, knowledge, emergency, rate-limit and telemetry checks;
- an explicit initial exposure percentage from 1 to 99;
- an explicit observation period.

## Promotion

A rollout uses an initial canary stage followed by full exposure. Direct initial exposure at 100% is prohibited. Promotion is permitted only when every required production check continues to pass throughout the observation window.

## Failure behaviour

Any failed, missing or indeterminate required check must stop promotion. The required response is:

1. disable the public assistant;
2. execute the approved rollback plan;
3. retain privacy-safe incident evidence.

## Data boundary

The rollout record contains only release identity and control posture. It must not contain origins, prompts, responses, bindings, secrets, IP addresses or customer data.

This contract does not deploy the Worker or alter live Cloudflare traffic.
