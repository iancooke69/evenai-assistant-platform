# Disabled Worker deployment

The `Deploy disabled Worker` workflow creates a production Worker deployment while keeping the assistant inaccessible to the public.

## Preconditions

- the exact release commit has passed the manual release gate;
- the successful release-gate workflow run ID is supplied;
- its retained `manual-release-gate-evidence` artifact is available;
- `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` are configured for the protected `production-disabled` environment;
- `wrangler.jsonc` keeps `workers_dev` false and `ENABLE_PUBLIC_ASSISTANT` set to `false`.

## Execution

The workflow checks out the exact release commit, downloads and validates matching gate evidence, runs the complete repository suite, validates the disabled Cloudflare posture and deploys that exact commit.

## Evidence

After a successful deployment, the workflow uploads `disabled-worker-deployment-evidence`. The record contains release and workflow identities plus control posture only. It excludes routes, origins, prompts, responses, bindings, credentials, IP addresses and customer data.

## Boundary

This workflow does not enable public access, change approved origins, perform post-deployment verification, authorize a canary or promote traffic. Those remain separate mandatory stages.
