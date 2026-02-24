# Contract-Driven `db update` (lossy MVP)

Date: 2026-02-23  
Status: Draft

## Summary

Implement `prisma-next db update` as the migration-style reconciliation command for databases that already have a contract marker.

This MVP intentionally:

- does **not** use `@deprecated` / `@deleted` authoring hints,
- allows lossy operation classes (`additive`, `widening`, `destructive`) where implemented by planner/runner,
- requires marker presence and fails fast when database adoption has not happened yet.

`db update` reuses the existing planner/runner pipeline and keeps marker/ledger audit invariants intact.

## Context

Current CLI support includes `db init`, `db verify`, `db sign`, and related schema commands. `db init` is additive-only and bootstraps unmanaged databases.

For incremental contract evolution, we need a command that:

- starts from managed DB state (marker exists),
- can reconcile both additive and lossy deltas,
- remains deterministic and auditable under the migration subsystem rules.

The architecture already has these primitives:

- marker + ledger model,
- planner policy classes (`additive`, `widening`, `destructive`),
- runner lock, checks, schema verification, and marker/ledger writes.

## Goals

- Add `prisma-next db update` command with plan/apply modes.
- Make marker presence mandatory for this command.
- Plan using live schema + desired contract with lossy-capable policy.
- Execute with plan origin set from marker to enforce drift safety.
- Keep full runner checks enabled.
- Add tests first for CLI surface and planner lossy behavior.
- Document command semantics and updated architecture guidance.

## Non-goals

- No lifecycle-hint planning (`@deprecated`, `@deleted`) in this milestone.
- No contract-to-contract planner API redesign.
- No environment promotion policy system.
- No cross-family implementation.

## Proposed behavior

### CLI

Command:

```bash
prisma-next db update [--db <url>] [--config <path>] [--plan] [--json] [-v] [-q] [--timestamps] [--color/--no-color]
```

### Flow

1. Load config and desired `contract.json`.
2. Connect to DB.
3. Read marker.
4. If marker missing: fail with `db init` guidance.
5. Introspect live schema.
6. Plan using lossy-capable policy.
7. Attach plan origin from marker hashes.
8. In `--plan`: return rendered/JSON plan only.
9. In apply mode: execute runner with full checks enabled.
10. On success, runner updates marker and appends ledger entry.

### Safety and determinism

- Origin hash checks remain mandatory (runner behavior).
- Advisory lock and transaction behavior remain unchanged.
- Operation ordering and IDs must remain deterministic.
- Structured errors and stable CLI contract remain in place.

## Design details

### Planner policy for `db update`

Use operation policy:

```ts
{ allowedOperationClasses: ['additive', 'widening', 'destructive'] }
```

Planner changes in Postgres target should cover supported lossy cases and still fail with explicit conflicts when change is not safely expressible.

### Marker semantics

- `db update` requires marker row.
- Plan origin is set to marker values before runner execution.
- Runner remains the single writer for marker and ledger.

## Implementation plan

1. Add failing CLI tests for `db update`.
2. Add failing planner tests for widening/destructive diffs.
3. Implement Postgres planner lossy operations.
4. Add control API `dbUpdate` operation and types.
5. Add CLI command wiring and output formatters.
6. Update docs.
7. Run focused integration and planner tests.

## Acceptance criteria

- `db update --plan` produces deterministic lossy-capable plan output.
- `db update` apply runs and writes marker+ledger via runner.
- Missing marker produces clear actionable failure.
- Existing `db init` behavior remains unchanged.
- Help snapshots and CLI README include `db update`.
- Architecture docs reflect this MVP strategy and limitations.
