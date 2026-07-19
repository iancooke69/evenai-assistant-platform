# Disabled deployment verification

The `Verify disabled Worker deployment` workflow verifies a completed Cloudflare deployment before any public or canary activation is considered.

## Required inputs

- the exact full release commit SHA used by the deployment;
- the successful `Deploy disabled Worker` workflow run ID;
- an HTTPS production URL that must not serve assistant responses.

## Evidence chain

The workflow downloads the retained `disabled-worker-deployment-evidence` artifact from the specified deployment run. The artifact must match both the release commit and the deployment workflow run ID and must preserve the mandatory disabled control posture.

## Live checks

The workflow checks:

- a current Cloudflare deployment exists for `evenai-ggc-assistant`;
- the exact deployed release configuration keeps `workers_dev` disabled;
- the live `ENABLE_PUBLIC_ASSISTANT` binding remains `false`;
- the live `ALLOWED_ORIGINS` binding remains empty;
- the production probe URL does not serve an assistant response;
- the production probe response does not expose an allowed CORS origin.

The Cloudflare API responses and probe body are used only during the workflow. They are not retained as artifacts.

## Decision

A complete pass produces `retain-disabled-deployment`. Any failed live check produces `disable-and-rollback`. This verification does not authorize canary activation or public traffic.

## Privacy boundary

The retained evidence contains release and workflow identities, check outcomes and control posture only. It excludes the production URL, origins, response content, bindings, credentials, IP addresses, prompts and customer data.
