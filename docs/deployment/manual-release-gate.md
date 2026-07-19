# Manual release gate

The manual release gate authorizes a specific production release commit for deployment with the public assistant still disabled. It does not deploy the Worker, configure Cloudflare or enable public traffic.

## Required inputs

- full release commit SHA;
- distinct full rollback commit SHA;
- intended production Worker route;
- public privacy notice URL;
- comma-separated approved HTTPS origins.

## Gate sequence

1. Check out the exact release commit.
2. Run the complete repository test suite with `npm test`.
3. Evaluate deployment readiness using declared production controls.
4. Validate release and rollback identities.
5. Produce privacy-safe release evidence.
6. Upload the evidence as a 30-day GitHub Actions artifact.

## Evidence boundary

The artifact records release identity, rollback identity, service, environment, origin count and required control posture. It excludes routes, origins, privacy URLs, secrets, bindings, prompts, responses, IP addresses and customer data.

## Safety boundary

A passing gate permits only a disabled deployment. Public activation remains prohibited until post-deployment verification passes and the enforced canary rollout process is approved.
