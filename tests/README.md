# Test Structure

Planned suites:

- unit tests for reusable packages;
- integration tests for retrieval, provider and connector boundaries;
- regression tests for safety, price integrity and tenant isolation;
- reference-implementation acceptance tests for GetGasCert.

No production deployment may proceed while a required safety or regression test is failing.
