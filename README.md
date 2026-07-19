# EVENAI Assistant Platform

A modular assistant platform for service businesses, built around deterministic knowledge retrieval, safety routing and reusable operational controls.

## Reference implementation

**RI-001: GetGasCert Assistant**

The GetGasCert reference implementation validates the platform against commercial gas certification, emergency enquiries, pricing and service-area questions.

## Implemented

- approved knowledge schemas and validation;
- deterministic knowledge retrieval;
- emergency and safety routing;
- conversation orchestration and response composition;
- executable GetGasCert assistant runtime;
- framework-neutral HTTP contract;
- Cloudflare Worker shell;
- exact-origin browser policy;
- fail-closed rate-limit boundary;
- privacy-minimised telemetry contract;
- deployment-readiness, release, rollback and verification policy modules.

## Planned

- production Cloudflare bindings and custom routing;
- public website activation;
- lead capture and WhatsApp escalation;
- booking integrations;
- analytics infrastructure;
- AI-provider integration;
- reusable multi-tenant provisioning.

## Repository layout

- `apps/` — business-specific assistant implementations
- `packages/` — reusable platform modules
- `docs/` — architecture, specifications, safety and operational documentation
- `knowledge/` — shared schemas and reusable knowledge templates
- `tests/` — unit, integration and regression coverage
- `scripts/` — validation utilities
- `assets/` — approved branding and evidence assets

## Delivery status

The deterministic platform core and GetGasCert reference runtime are implemented. No production assistant has been deployed or publicly enabled.
