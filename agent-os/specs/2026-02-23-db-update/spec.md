# Summary

Add `prisma-next db update` as the contract-driven reconciliation command for existing databases. The command plans and applies additive, widening, and destructive schema changes, exposes plan/apply modes with JSON output, and preserves runner safety checks and marker/ledger audit behavior. Works on any database, whether or not it has been initialized with `db init`.

# Description

This branch implements a new CLI command, `prisma-next db update`, and a matching control API operation to update a database schema to match the current emitted contract. The command introspects the live schema, plans a migration allowing additive, widening, and destructive operation classes, and either outputs a dry-run plan or applies the plan via the migration runner. The marker table is created if missing and updated regardless of prior content. It also adds supporting docs, demos, and end-to-end tests that mirror the scenarios in `DEMO.md`.

# Requirements

## Functional Requirements

- Provide a new CLI command `prisma-next db update` that mirrors `db init` flag surface:
  - `--db <url>`, `--config <path>`, `--plan`, `--json [format]`, `-q`, `-v`, `-vv`, `--timestamps`, `--color/--no-color`.
- Load config and resolve the emitted contract JSON from `config.contract.output` or default to `src/prisma/contract.json`.
- Require a database connection string from `--db` or `config.db.connection`.
- Reject unsupported JSON format `ndjson` with a structured CLI error.
- Create the contract marker table if missing; update the marker regardless of prior content. No preconditions required.
- Introspect the live schema and plan reconciliation against the emitted contract using a policy that allows additive, widening, and destructive operations.
- In `--plan` mode, return a deterministic plan summary without applying changes.
- In `--plan` mode, emit SQL DDL alongside the plan summary when the target belongs to the SQL family.
- In apply mode, execute with full runner checks enabled and update marker + ledger through the runner.
- Map planner conflicts and runner failures to structured CLI errors with actionable recovery guidance.
- Expose a programmatic control API operation (`client.dbUpdate`) that mirrors the CLI behavior.

## Non-Functional Requirements

- Deterministic planning: operation ordering and IDs are stable for identical inputs.
- Safety invariants: runner checks, advisory locks, and marker/ledger audit rules remain unchanged from existing migration behavior.
- CLI output remains stable and machine-readable; JSON output must be consistent with existing migration envelopes.
- The command must be idempotent when the database already matches the contract (0 operations planned/applied).

## Non-goals

- Lifecycle-hint planning (`@deprecated`, `@deleted`).
- Contract-to-contract planner redesign.
- Environment promotion or history policies.
- Non-SQL family or target support beyond existing migrations capability.

# Acceptance Criteria

- [ ] `prisma-next db update --plan` returns a deterministic plan with operation IDs, labels, classes, and destination hash.
- [ ] `prisma-next db update --plan` emits SQL DDL when the target is in the SQL family.
- [ ] `prisma-next db update` applies the planned operations and writes a new marker + ledger entry.
- [ ] Missing markers are handled transparently (marker table created automatically, no precondition error).
- [ ] Planner conflicts return `PLANNING_FAILED` with conflict details.
- [ ] Runner failures return `RUNNER_FAILED` with a remediation hint.
- [ ] `--json` returns an `object` envelope; `--json ndjson` fails with a structured CLI error.
- [ ] Running `db update` when no changes exist reports 0 operations and leaves the schema unchanged.
- [ ] Documentation includes `db update` command usage, semantics, and difference from `db init`.
- [ ] E2E tests cover demo scenarios for plan/apply, missing marker, conflicts, runner failure, and JSON output.

# Other Considerations

## Security

- Database connection strings are treated as sensitive; CLI output should mask credentials where possible.
- Destructive operations are permitted; operators should run `--plan` first and rely on existing guardrails and backups.

## Cost

**Assumption:** Typical usage is developer or CI-driven with small schemas; expected 30-day incremental cost is in the $10s (local or shared Postgres), dominated by normal database operation rather than CLI overhead.

## Observability

- Progress spans are emitted for introspection, planning, apply, and per-operation execution to support CLI progress output.
- JSON output includes `timings.total` and plan metadata suitable for CI logs.

## Data Protection

- The command can perform destructive schema changes; operators should ensure data backups and retention requirements are met before applying.
- The marker/ledger audit trail remains the source of truth for applied contract changes.

## Analytics

**Assumption:** No analytics events are emitted from the CLI in this phase; usage tracking is limited to local logs or CI output.

# References

- `agent-os/specs/2026-02-23-db-update/planning/requirements.md`
- `DEMO.md`
- `docs/commands/SUMMARY.md`
- `docs/commands/db-update.md`
- `packages/1-framework/3-tooling/cli/src/commands/db-update.ts`
- `packages/1-framework/3-tooling/cli/src/control-api/operations/db-update.ts`
- `examples/db-update-demo/README.md`
- `test/integration/test/cli.db-update.e2e.test.ts`
- `test/integration/test/cli.db-update.e2e.errors.test.ts`

# Open Questions

No open questions at this time.
