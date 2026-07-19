# Production release manifest

The release manifest is a deterministic approval artifact. It does not deploy, enable or configure the Cloudflare Worker.

A manifest can be created only after the deployment-readiness policy reports no blockers. The caller must provide distinct full 40-character release and rollback commit SHAs.

The manifest records only:

- schema version
- service identifier
- production environment
- release and rollback commit identities
- public route
- approved-origin count
- required control flags

It deliberately excludes origin values, binding objects, secrets, request data, privacy-notice URLs and customer information.

The repository's current production configuration remains disabled and incomplete. Creating this contract does not constitute deployment approval.
