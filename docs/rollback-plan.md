# Production rollback contract

The GetGasCert reference implementation must have a deterministic rollback plan before any public deployment is approved.

## Required sequence

1. Disable the public assistant immediately.
2. Restore the recorded full rollback commit.
3. Verify the health endpoint.
4. Verify that the assistant remains disabled.
5. Record the incident outcome.

## Trigger conditions

Rollback is required for a failed health check, elevated server errors, a safety-routing regression, an origin-policy regression or a rate-limiter regression.

## Data boundary

The rollback plan records only release identities, deterministic trigger codes, ordered actions and completion criteria. It does not contain origins, bindings, secrets, customer data, request content or telemetry payloads.

## Current state

This contract does not deploy, enable or configure the Worker. A production rollback plan can only be created from a valid production release manifest containing distinct full release and rollback commit SHAs and the required control declarations.
