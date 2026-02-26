# Summary

Close out the PSL Contract Authoring project by verifying acceptance criteria, migrating any long-lived docs to `docs/`, and deleting the transient `projects/psl-contract-authoring/` workspace.

# Description

Everything under `projects/` is transient. Once implementation is complete, we need a deliberate close-out pass so the repository is left with durable documentation and no leftover shaping artifacts.

This spec defines the close-out deliverable: verification, doc migration, and deletion of the project directory.

# Requirements

## Functional Requirements

- Verify each acceptance criterion in `projects/psl-contract-authoring/spec.md` is met.
- For each criterion, link to:
  - the test(s) that verify it, or
  - a manual verification step (only if automation is not practical).
- If any long-lived docs were created under `projects/psl-contract-authoring/`, migrate them into an appropriate location under `docs/`.
- Delete `projects/psl-contract-authoring/`.

## Non-Functional Requirements

- Do not lose context: migrated docs must preserve links and be discoverable.

## Non-goals

- Introducing new behavior. Close-out is documentation and cleanup only.

# Acceptance Criteria

- [ ] Every project acceptance criterion has a corresponding verification link (test or manual check).
- [ ] Any long-lived docs are migrated into `docs/` with working links.
- [ ] `projects/psl-contract-authoring/` is deleted.

# Other Considerations

## Security

- Ensure no sensitive scratch notes are migrated unintentionally.

## Cost

- None.

## Observability

- Keep a short final summary in the migrated docs describing where to find the project spec/plan history (or confirm they were intentionally deleted).

## Data Protection

- N/A.

## Analytics

- None.

# References

- Project spec: `projects/psl-contract-authoring/spec.md`
- Project plan: `projects/psl-contract-authoring/plans/plan.md`
- Workspace rules: `.cursor/rules/doc-maintenance.mdc`

# Open Questions

- None.
