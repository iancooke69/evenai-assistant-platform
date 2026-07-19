# Security Baseline

- Keep all provider keys and integration secrets server-side.
- Apply tenant-scoped authorization to every stored record and request.
- Validate and constrain all assistant inputs and outputs.
- Rate-limit public endpoints and impose configurable cost ceilings.
- Minimise personal-data collection and define retention periods.
- Redact secrets and unnecessary personal data from logs.
- Require reviewed migrations and rollback instructions for production changes.
- Maintain automated tests for tenant isolation, unsafe-output blocking and price integrity.
