# Platform Architecture

## Status

Foundation draft for the EVENAI Assistant Platform.

## Architectural principles

1. Approved-knowledge retrieval before model generation.
2. Business-specific configuration isolated from reusable platform code.
3. Deterministic handling for prices, booking links, emergency routes and safety rules.
4. Provider-neutral interfaces for AI models, booking systems and messaging channels.
5. Auditable conversations, configuration versions and knowledge revisions.
6. Least-privilege access, explicit tenant isolation and controlled operating costs.

## Logical flow

```text
Business website
  -> branded chat interface
  -> assistant API
  -> safety and policy checks
  -> knowledge retrieval
  -> conversation orchestration
  -> AI provider
  -> deterministic response validation
  -> booking, lead or escalation action
  -> analytics and audit record
```

## Reference implementation

RI-001 is the GetGasCert Assistant under `apps/ggc`.
