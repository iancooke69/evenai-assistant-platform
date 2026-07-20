# Canary release worktree cleanup

The protected canary workflow materializes the verified release into `release-source` during baseline normalization and again during activation.

Before the activation stage, the workflow now removes the normalization worktree, removes any residual directory and prunes Git worktree metadata. This prevents a missing-but-registered `release-source` worktree from blocking the second materialization with Git exit code 128.

A repository regression test requires the cleanup step to remain between baseline normalization and protected activation.
