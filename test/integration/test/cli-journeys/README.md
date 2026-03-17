# CLI Journey Tests

End-to-end tests organized by real-world user workflow, not by individual CLI command.
Each journey composes multiple CLI commands against evolving database state in a single `it()` block.

These tests are the primary regression suite for the Prisma Next CLI's database lifecycle commands.

## Running

```bash
pnpm test:journeys
```

## Test files

### Happy paths

| File | What it covers |
|---|---|
| `greenfield-setup.e2e.test.ts` | New project with empty database: emit a contract, dry-run init to preview operations, apply init, confirm idempotency on re-run, verify marker and schema (tolerant + strict), introspect, and JSON output variants of verify/schema-verify |
| `schema-evolution-migrations.e2e.test.ts` | **Migration lifecycle**: plan a migration, show its details, verify the planned directory, check status (offline + online), apply, confirm all applied, db verify. Also covers edge cases: apply when already up-to-date (noop), plan when contract is unchanged (noop), show by path and not-found. **Init-to-migrations transition**: initialize with `db init`, then switch to the migration workflow |
| `multi-step-migration.e2e.test.ts` | Planning two migrations (base → additive → v3) without applying either, then batch-applying both at once. Verifies pending/applied status reporting |
| `db-update-workflows.e2e.test.ts` | **Direct update**: `db update` without migrations (additive-only, dry-run, noop). **Destructive update**: drops a column, tests `--no-interactive` rejection, `--json` error envelope, and `--json -y` auto-accept. **Re-init conflict**: `db init` on an already-initialized DB with a different contract fails; recovery via `db update` |
| `brownfield-adoption.e2e.test.ts` | **Adopt Prisma on existing DB**: introspect → emit matching contract → schema-verify → sign → verify → evolve via db update. **Schema mismatch**: emit a contract that doesn't match the DB, observe sign/schema-verify failures, fix contract, retry |

### Drift detection and recovery

| File | What it covers |
|---|---|
| `drift-schema.e2e.test.ts` | **Phantom drift**: marker OK but schema diverged via manual DDL (dropped column); `db verify` now fails by default because it runs structural verification, while `db verify --shallow` reproduces marker-only verification. **Extra column drift**: DBA adds a column via manual DDL; tolerant `db verify` / `db schema-verify` pass, strict schema-verify fails; recover by expanding the contract and running `db update` |
| `drift-marker.e2e.test.ts` | **Missing marker**: contract emitted but `db init` never run — verify/schema-verify fail, init recovers. **Stale marker**: contract changed without updating DB — verify fails, `db update` recovers. **Mixed-mode evolution**: iterate through multiple contract versions using `db update` (no migration files). **Corrupt marker**: marker row overwritten with garbage — verify fails, schema-verify passes (schema intact), `db sign` recovers |
| `drift-migration-dag.e2e.test.ts` | **Chain breakage**: after building a migration chain, a migration directory is deleted from disk. `migration apply` fails (no path to destination), recovery by re-planning the missing edge |

### Error scenarios (no database needed)

| File | What it covers |
|---|---|
| `config-errors.e2e.test.ts` | `contract emit` fails gracefully for: missing config file, explicit nonexistent path, invalid TypeScript syntax, config missing the contract field |
| `connection-and-contract-errors.e2e.test.ts` | **Missing connection**: `db verify` without a database connection configured. **No contract yet**: db init/verify fail when contract.json hasn't been generated. **Target mismatch**: contract.json tampered to say "mysql" while config targets postgres. **Unmanaged DB**: `db init` on a database with pre-existing tables created via raw SQL |
| `help-and-flags.e2e.test.ts` | Global CLI flags: `--no-color` suppresses ANSI codes, `-q` reduces output, `-v` increases output |

## Design principles

- **Single `it()` per journey**: Steps run sequentially within one test, identified by assertion labels (e.g., `expect(exitCode, 'A.03: db init').toBe(0)`). This avoids test-ordering fragility and keeps each test self-contained.
- **Database isolation**: Each journey (`describe` block) gets its own PGlite instance via `beforeAll`/`afterAll`. Journeys within a file share no database state.
- **Parallel at file level**: Vitest parallelizes across files (4 workers). Steps within a journey are sequential.
- **Behavior over flags**: Assertions target exit codes, JSON shape keys, and state transitions — not exact flag names or output strings.
