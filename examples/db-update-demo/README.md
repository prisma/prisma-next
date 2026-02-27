# Prisma Next db update Demo

This demo backs the scenarios in `DEMO.md` and uses one database per scenario.

## Prerequisites

- Node version matches `package.json` `engines.node`.
- `pnpm install` has been run at the repo root.
- Bun is installed (scenarios run with Bun).

## Environment

Scenario database URLs live in `examples/db-update-demo/.env`.

## Run a scenario

```bash
bun run scripts/scenario.ts 1
bun run scripts/scenario.ts 2
bun run scripts/scenario.ts 3
```

Each run resets the scenario database, applies the scenario setup, then executes the scenario command.

Add `--sql` to print DDL statements for each `db init` / `db update` plan that runs during the scenario.

```bash
bun run scripts/scenario.ts 2 --sql
```

There is also a convenience script:

```bash
pnpm --filter prisma-next-db-update-demo scenario:sql -- 2
```

## Create all databases

```bash
bun run scripts/create-dbs.ts
```

## Restore a scenario database

```bash
bun run scripts/scenario.ts 4 --restore
```

`--restore` (alias `--setup`) resets the database and reapplies the scenario’s initial state without executing the scenario command. This is the fast way to return to a known baseline.

If the database does not exist, the scripts attempt to create it using the same credentials. If your role cannot create databases, pre-provision the `scenario_<n>` databases first.

## Scenario map

1. Missing marker (fails fast)
2. Preview a contract change (plan mode)
3. Apply the update
4. No-op update
5. Destructive changes with safety review
6. Planning conflicts
7. Runner failure after planning
8. JSON output for tooling
9. Use config connection or override it
