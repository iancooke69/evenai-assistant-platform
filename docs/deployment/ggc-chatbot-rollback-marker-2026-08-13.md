# GetGasCert chatbot rollback marker — 2026-08-13

This is an identity-only rollback marker. It does not authorize or execute a rollback.

## Current production identity

- Service: `evenai-ggc-assistant`
- Current Worker version: `1891dcad-0ac9-4854-929f-1575275641ba`
- Current deployment run: `31740198131`
- Current repository commit: `a2b00675e63aaa5e33659775f2cc9adee6d3f58f`
- Validated application release commit: `2eabf200fbfbc8d54e94eb1030b9bd1b289fc4a3`
- Current traffic allocation at release verification: 100%

## Primary rollback identity

- Previous known-good enabled Worker version: `90863c7b-22f3-4886-aa17-7859de3b6ba7`
- Previous successful production deployment run: `31739496237`
- Required state if this target is explicitly approved for rollback: one verified Worker version at 100%.

The previous Worker identity was recorded directly by deployment run `31740198131` immediately before the current Worker was promoted.

## Use boundary

Before this marker is used operationally, independently verify that the recorded previous Worker version still exists and still carries the required enabled-production controls. Do not substitute an unverified version.

A rollback requires a new explicit owner authorization. This marker is not a deployment authorization, workflow trigger, or automatic rollback instruction.

If the primary previous-enabled target cannot be verified healthy, follow `docs/rollback-plan.md` and use the repository's fail-closed recovery controls.

## Linked release record

See `docs/deployment/ggc-chatbot-production-release-2026-08-13.md` for architecture, release evidence, acceptance criteria and verification scope.
