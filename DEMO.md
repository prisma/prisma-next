# prisma-next db update Demo

This demo shows how to plan and apply contract-driven schema updates with `prisma-next db update`. It covers success paths, no-ops, and failures with clear recovery steps.

## Demo project

The runnable demo lives in `examples/db-update-demo`.

- Run a scenario: `bun run scripts/scenario.ts <n>`
- Restore a scenario database: `bun run scripts/scenario.ts <n> --restore`

Scenario database URLs are stored in `examples/db-update-demo/.env`.

## Prerequisites

- Node version matches `package.json` `engines.node`.
- `prisma-next.config.ts` exists in the repo root.
- `contract.json` is emitted to `src/prisma/contract.json` or to `config.contract.output`.
- A database URL is available.

## One-time setup

1. Set a database URL.

```bash
export DATABASE_URL='postgresql://user:pass@localhost:5432/prisma_next'
```

2. Emit the contract.

```bash
prisma-next contract emit --config prisma-next.config.ts
```

3. Adopt the database the first time you use it.

```bash
prisma-next db init --db $DATABASE_URL
```

## What db update does

`prisma-next db update` reconciles a marker-managed database to the current contract. It reads the contract marker, introspects the live schema, plans a migration with additive, widening, and destructive operations, then applies the plan and updates the marker.

## Scenario 1: Missing marker (fails fast)

Use this when the database has not been signed.

```bash
prisma-next db update --db $DATABASE_URL
```

Expected output:

```text
✖ Database marker is required before db update (MARKER_REQUIRED)
  Why: Contract marker not found in database
  Fix: Run `prisma-next db init` first to sign the database, then re-run `prisma-next db update`
```

Recovery:

1. Run `prisma-next db init --db $DATABASE_URL`.
2. Re-run `prisma-next db update --db $DATABASE_URL`.

## Scenario 2: Preview a contract change (plan mode)

Use this after changing the schema and re-emitting the contract.

1. Edit your schema and re-emit the contract.

```bash
prisma-next contract emit --config prisma-next.config.ts
```

2. Preview the migration plan.

```bash
prisma-next db update --db $DATABASE_URL --plan
```

Example output:

```text
✔ Planned 1 operation(s)
│
└─ Add column nickname on user [additive]

Destination hash: sha256:new-hash...

This is a dry run. No changes were applied.
Run without --plan to apply changes.
```

## Scenario 3: Apply the update

Use this after a successful plan.

```bash
prisma-next db update --db $DATABASE_URL
```

Example output:

```text
✔ Applied 1 operation(s)
  Marker written: sha256:new-hash...
```

## Scenario 4: No-op update

Use this when the database already matches the contract. This is common right after `db init` or after a previous `db update`.

```bash
prisma-next db update --db $DATABASE_URL
```

Example output:

```text
✔ Applied 0 operation(s)
  Marker written: sha256:current-hash...
```

## Scenario 5: Destructive changes with a safety review

Use this when you remove tables or columns. Plan mode shows destructive operations before apply.

```bash
prisma-next db update --db $DATABASE_URL --plan
```

Example output:

```text
✔ Planned 2 operation(s)
│
├─ Drop column legacy_code on user [destructive]
└─ Drop table legacy_audit [destructive]

Destination hash: sha256:new-hash...

This is a dry run. No changes were applied.
Run without --plan to apply changes.
```

## Scenario 6: Planning conflicts

This happens when the live database diverges from the contract and the planner cannot reconcile the difference.

```bash
prisma-next db update --db $DATABASE_URL
```

Example output:

```text
✖ Migration planning failed due to conflicts (PLANNING_FAILED)
  Conflicts (showing 1 of 1):
    - [typeMismatch] Column user.email: expected text, found varchar(100)
```

Recovery:

1. Inspect the conflict.
2. Fix schema drift or update the contract to match reality.
3. Re-run `prisma-next db update --db $DATABASE_URL`.

## Scenario 7: Runner failure after planning

This happens when the runner rejects the apply phase. A common cause is marker drift between plan and apply.

```bash
prisma-next db update --db $DATABASE_URL
```

Example output:

```text
✖ Origin mismatch (RUNNER_FAILED)
  Why: Marker drifted
  Fix: Inspect the reported conflict, reconcile schema drift if needed, then re-run `prisma-next db update`
```

Recovery:

1. Verify which contract last wrote the marker.
2. Reconcile schema drift or re-apply the intended change.
3. Re-run `prisma-next db update --db $DATABASE_URL`.

## Scenario 8: JSON output for tooling

Use JSON output for CI or scripts. Only `object` format is supported.

```bash
prisma-next db update --db $DATABASE_URL --plan --json
```

Example output:

```json
{
  "ok": true,
  "mode": "plan",
  "plan": {
    "targetId": "postgres",
    "destination": {
      "storageHash": "sha256:new-hash",
      "profileHash": "sha256:new-profile"
    },
    "operations": [
      {
        "id": "column.user.nickname",
        "label": "Add column nickname on user",
        "operationClass": "additive"
      }
    ]
  },
  "origin": {
    "storageHash": "sha256:origin",
    "profileHash": "sha256:origin-profile"
  },
  "summary": "Planned 1 operation(s)",
  "timings": { "total": 123 }
}
```

`--json ndjson` is not supported and exits with an error.

## Scenario 9: Use config connection or override it

Use the config default:

```bash
prisma-next db update
```

Override the connection for a one-off run:

```bash
prisma-next db update --db $DATABASE_URL
```

## Fast checklist

1. Emit contract.
2. Use `db init` once per database.
3. Use `db update --plan` to preview.
4. Use `db update` to apply.
5. Resolve conflicts before re-running.
