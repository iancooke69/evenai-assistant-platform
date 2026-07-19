# Post-deployment verification contract

This contract defines the minimum evidence required immediately after a production release of the GetGasCert reference implementation.

## Required checks

- `/health` responds successfully.
- An approved browser origin can reach the assistant.
- A known knowledge query returns the approved deterministic response.
- Emergency routing overrides commercial knowledge.
- Rate limiting permits and denies requests as configured.
- Privacy-safe telemetry accepts an operational event.

## Decision rule

Every check must pass. Any missing, failed or indeterminate check produces the action `disable-and-rollback`. There is no partial-success state.

## Output boundary

The verification record contains only the release commit, observation timestamp, required check names, failed check names and resulting action. It excludes origins, prompts, response text, bindings, secrets, IP addresses and customer information.

## Current state

This repository remains undeployed. The contract does not execute live probes, enable the public assistant or alter Cloudflare resources.
