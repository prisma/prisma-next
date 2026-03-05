# Summary

Add a `migration show` subcommand that displays the contents of a migration package in the same human-readable format used by `db update --dry-run`, including operation class badges (`[additive]`, `[destructive]`, `[widening]`). Integrate it into `migration plan` so newly planned migrations are displayed immediately. This gives users visibility into destructive operations at the moment they're most relevant — plan time — without requiring confirmation flags that create friction in CI.

# Description

Today, `migration plan` writes a migration package to disk and prints a minimal summary (operation IDs and labels). It does not show operation classes, SQL previews, or any warning about destructive operations. A user who adds a `DROP COLUMN` to their contract sees the same output as someone who adds a column — there's no visual signal that the migration includes data-loss operations.

Meanwhile, `db update --dry-run` has a rich output format that shows each operation with its class badge (`[additive]`, `[destructive]`), a DDL preview, and clear visual hierarchy. This format already exists and is well-tested.

The goal is to:
1. Create `migration show` as a standalone command for inspecting any on-disk migration
2. Reuse `migration show`'s rendering in `migration plan` so the user sees the full detail immediately after planning
3. Surface destructive operations prominently so the human review step (PR review) is informed

This is a UX improvement, not a policy gate. No `--accept-data-loss` flag is needed because `migration plan` writes files (reversible — delete and re-plan) and `migration apply` runs migrations that were already reviewed in a PR. The safety checkpoint is the PR review, and `migration show` ensures reviewers can see what they're approving.

# Requirements

## Functional Requirements

### FR-1: `migration show` command

- New subcommand: `prisma-next migration show [target]`
- `[target]` is an optional positional argument that can be:
  - A **directory path** to a migration package (e.g. `migrations/20260303T1400_add_users`)
  - A **hash or hash prefix** matching a migration's `edgeId` (git-style prefix matching — a unique prefix is enough)
- When `[target]` is omitted, show the latest migration (the DAG leaf migration package)
- When `[target]` is omitted, clearly state which migration was selected in the output (directory name)
- Hash prefix resolution:
  - If the prefix uniquely matches one migration's `edgeId`, show that migration
  - If the prefix matches multiple migrations, list the ambiguous matches with their directory names and `edgeId` values so the user can disambiguate
  - If the prefix matches nothing, error with "No migration found matching prefix"
- No database connection required (fully offline)
- Output format reuses the existing `formatMigrationPlanOutput` from `output.ts` (same renderer as `db update --dry-run`):
  - Operation tree with class badges (`[additive]`, `[destructive]`, `[widening]`)
  - `from` and `to` hashes
  - `edgeId` and attestation status (attested vs draft)
  - Migration directory name
  - `createdAt` timestamp
  - DDL preview (SQL statements from ops) — always shown, not verbose-only
- Supports `--json` for machine-readable output
- Supports standard global flags (`-q`, `-v`, `--color`, `--no-color`, `--timestamps`)

### FR-2: Destructive operation highlighting

- Operations with `operationClass: 'destructive'` are visually prominent in TTY output
- When destructive operations are present, print a warning line after the operation tree (e.g. `⚠ This migration includes N destructive operation(s)`)
- The warning is informational only — it does not block the command or require a flag

### FR-3: Integration with `migration plan`

- After `migration plan` writes a migration package, display its contents using the same rendering as `migration show`
- Replace the current minimal output with the full `migration show` format
- The `MigrationPlanResult` type should include `operationClass` on each operation (currently only `id` and `label`)

### FR-4: SQL preview in show output

- Read the `ops.json` and display SQL statements from each operation's `execute` steps
- Format as a DDL preview block (same style as `db update --dry-run`)
- Always shown (not verbose-only) — the DDL preview is the primary value of `migration show`

## Non-Functional Requirements

### NFR-1: Code reuse
- Reuse the existing `formatMigrationPlanOutput` in `output.ts` (used by `db update --dry-run` and `db init --dry-run`) for rendering
- Delete the local `formatMigrationPlanOutput` in `migration-plan.ts` and replace with a call to the shared one
- Do not create a new formatting function — extend the existing one if needed

### NFR-2: Layering compliance
- `migration show` lives in the CLI package (`packages/1-framework/3-tooling/cli/`)
- It reads from `@prisma-next/migration-tools/io` (existing I/O functions)
- `pnpm lint:deps` must pass

### NFR-3: No breaking changes
- `migration plan --json` output may add new fields but must not remove or rename existing fields
- Existing test assertions on `migration plan` output should continue to pass (or be updated to reflect the richer output)

## Non-goals

- No `--accept-data-loss` flag on `migration plan` or `migration apply`
- No policy gates or confirmation prompts
- No interactive mode
- No `migration diff` (comparing two arbitrary migrations)
- No graph visualization

# Acceptance Criteria

- [ ] `prisma-next migration show <dir>` displays the migration package contents with operation class badges
- [ ] `prisma-next migration show <hash-prefix>` resolves a migration by unique edgeId prefix and displays it
- [ ] `prisma-next migration show <ambiguous-prefix>` lists matching migrations for disambiguation
- [ ] `prisma-next migration show <unknown-prefix>` errors with "No migration found matching prefix"
- [ ] `prisma-next migration show` (no arg) defaults to the latest migration and states which one was selected
- [ ] `prisma-next migration show` errors clearly when no migrations exist
- [ ] Destructive operations are visually highlighted with a warning line
- [ ] DDL preview is always shown (not verbose-only)
- [ ] `prisma-next migration plan` output now includes operation class badges, DDL preview, and the destructive warning
- [ ] `migration plan --json` includes `operationClass` on each operation
- [ ] `migration show --json` produces valid, parseable JSON
- [ ] Existing `formatMigrationPlanOutput` in `output.ts` is reused (no new formatting function created)
- [ ] Local `formatMigrationPlanOutput` in `migration-plan.ts` is deleted
- [ ] `pnpm lint:deps` passes
- [ ] Existing `migration plan` tests pass (updated for richer output where needed)

# References

- `db update --dry-run` output formatter: `packages/1-framework/3-tooling/cli/src/utils/output.ts` (`formatMigrationPlanOutput`)
- `migration plan` command: `packages/1-framework/3-tooling/cli/src/commands/migration-plan.ts`
- Migration I/O: `packages/1-framework/3-tooling/migration/src/io.ts`
- Migration types: `packages/1-framework/3-tooling/migration/src/types.ts`
- On-disk migrations spec: `projects/on-disk-migrations/spec.md`
- ADR 028 — Migration Structure & Operations
- ADR 038 — Operation idempotency classification & enforcement

# Resolved Decisions

## RD-1: No confirmation flag — inform, don't gate

Destructive operations are surfaced as a prominent warning in `migration show` and `migration plan` output, but no flag is required to proceed. The rationale:

- `migration plan` writes files to disk (reversible — delete and re-plan)
- `migration apply` runs migrations that were already reviewed and merged via PR
- Requiring `--accept-data-loss` in CI creates friction without adding safety (CI would either hardcode it, defeating the purpose, or need to inspect migration files to decide)
- The human review checkpoint is the PR review, and `migration show` ensures reviewers can see what they're approving

This differs from `db update --accept-data-loss` which is appropriate because `db update` plans and applies in a single command with no intermediate review step.

## RD-2: Default to latest migration when no target provided

When `migration show` is invoked without a target argument, it reads the migrations directory, reconstructs the DAG, finds the leaf, and shows the corresponding migration package. The output includes a line like `Showing: migrations/20260303T1400_add_users` so the user knows which migration was selected.

If the DAG has multiple leaves (ambiguous), the command errors with `MIGRATION.AMBIGUOUS_LEAF` (same behavior as `migration plan`).

## RD-3: Git-style hash prefix resolution

The `[target]` argument is resolved in order:
1. If it looks like a file path (contains `/` or `\`), treat it as a directory path and read the migration package directly
2. Otherwise, treat it as a hash prefix — scan all attested migration packages and match against `edgeId` values
3. If exactly one migration matches, show it
4. If multiple match, list them all with directory name and full `edgeId` so the user can provide a longer prefix
5. If none match, error with the prefix and suggest checking `migration show` (no arg) to see available migrations

This follows git's convention where short SHAs work as long as they're unambiguous.

# Open Questions

None.
