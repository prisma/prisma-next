---
name: prisma-next-debug
description: Debug Prisma Next errors — route a symptom to a fix by reading the structured error envelope, looking up stable error codes (PN-CLI-4xxx, PN-MIG-2xxx, PN-RUN-3xxx), and finding the right recovery flow. Use for error, exception, won't typecheck, runtime error, MIGRATION.HASH_MISMATCH, drift, capability missing, planner conflict, prisma studio, EXPLAIN, query log, "my query crashed", "my emit failed", "my migration won't apply".
---

# Prisma Next — Debug

> **Edit your data contract. Prisma handles the rest.**

When things break, this skill triages the symptom and routes the agent to a fix. Prisma Next emits **structured errors** with stable codes (e.g. `PN-MIG-2042`, `PN-CLI-4011`, `PN-RUN-3005`); use the codes to look up the right recovery flow.

## When to Use

- User reports an error, exception, or unexpected behavior.
- User pastes a structured error envelope.
- User says "my query won't typecheck", "my migration won't apply", "my emit failed", "the runtime crashes".
- User mentions a specific error code (`PN-CLI-*`, `PN-MIG-*`, `PN-RUN-*`).
- User mentions: *Studio, EXPLAIN, query log, prepared statements, drift, hash mismatch, capability, planner*.

## When Not to Use

- User wants to write a new query / model / migration → the matching authoring skill.
- User wants to *prevent* errors (lints, budgets, type-level guards) → `prisma-next-runtime`.

## Key Concepts (before any workflow)

Every Prisma Next error is a **structured envelope** with at minimum:

```json
{
  "code": "PN-MIG-2042",
  "domain": "MIG",
  "kind": "MIGRATION.HASH_MISMATCH",
  "message": "human-readable summary",
  "why": "why this happened in this case",
  "fix": "what to do next",
  "docsUrl": "https://prisma-next.dev/errors/PN-MIG-2042",
  "meta": { /* code-specific context */ }
}
```

When the user pastes an error, **read every field** — `why` and `fix` are the framework telling you the recovery flow.

### Error-code domains

| Prefix | Domain | Skill |
|---|---|---|
| `PN-CLI-4xxx` | CLI commands (init, emit, db update, migration plan/apply) | This skill + the matching authoring skill |
| `PN-MIG-2xxx` | Migration runtime + planner | This skill → `prisma-next-migrations` |
| `PN-RUN-3xxx` | Runtime query execution | This skill → `prisma-next-queries` / `prisma-next-runtime` |
| `PN-CONTRACT-5xxx` | Contract emit / wiring validation | This skill → `prisma-next-contract` |

## Workflow — Read the envelope first

1. Get the user to paste the **full envelope**, not just the message. The `code`, `why`, `fix`, and `meta` are all load-bearing.
2. Look up the code in the matching reference file:
   - `references/cli-errors.md` — `PN-CLI-4xxx`
   - `references/migration-errors.md` — `PN-MIG-2xxx`
   - `references/runtime-errors.md` — `PN-RUN-3xxx`
   - `references/contract-errors.md` — `PN-CONTRACT-5xxx`
3. Follow the `fix` step. If it points at a workflow in another skill, chain to that skill.

If the user gives you only the message and not the code, ask for the full envelope.

## Signal-routing table — symptom → action

| Symptom | Likely cause | Action |
|---|---|---|
| "My query won't typecheck" | Contract stale; capability missing; query-interface mismatch | See [Query won't typecheck](#query-wont-typecheck) below. |
| "My query throws at runtime" | Read the error envelope. `PN-RUN-3xxx` codes are runtime; `PN-MIG-2xxx` codes are pre-flight checks. | See [Query throws at runtime](#query-throws-at-runtime). |
| "Capability X isn't available" | Capability not enabled in `prisma-next.config.ts`, or the extension contributing X isn't installed | See [Capability isn't available](#capability-isnt-available). |
| "Migration won't apply" | Marker mismatch, precondition failed, runner refused | See [Migration won't apply](#migration-wont-apply). |
| "Emit fails" | PSL syntax, missing namespace, conflicting extensions | See [Emit fails](#emit-fails). |
| "Contract is out of sync with DB" / drift | Manual SQL ran, or `db update` partially applied | See [Drift](#drift). |
| `MIGRATION.HASH_MISMATCH` | `migration.ts` edited without self-emit | See [`MIGRATION.HASH_MISMATCH`](#migrationhash_mismatch). |
| Planner-conflict failure | Rename without hint; destructive op blocked | See [Planner conflicts](#planner-conflicts). |

## Query won't typecheck

Common cases:

1. **Contract stale.** Re-emit:
   ```bash
   pnpm prisma-next contract emit
   ```
Re-run the type-check.
2. **`Contract` type parameter missing in `db.ts`.** Without `postgres<Contract, TypeMaps>(...)`, types collapse. Add the type parameters (see `prisma-next-runtime`).
3. **Capability not enabled.** `returning()` / `includeMany` etc. error at type-check when the capability isn't on. See [Capability isn't available](#capability-isnt-available).
4. **Wrong query interface.** Using `db.execute(...)` on an ORM builder (it's for SQL DSL plans). Switch to `.all()` / `.first()`.
5. **Model literal name typo.** `db.orm.user` instead of `db.orm.User`. The ORM accessor mirrors the contract's exact casing.

## Query throws at runtime

1. Read the error envelope. The `code` will be `PN-RUN-3xxx` for runtime execution errors.
2. Look up the code in `references/runtime-errors.md`. Common codes:
   - `PN-RUN-3001` — connection refused. Check `DATABASE_URL` reachable.
   - `PN-RUN-3005` — query timed out beyond `budgets({ maxDurationMs })`.
   - `PN-RUN-3012` — unique-constraint violation. Inspect `meta.constraint`.
   - `PN-RUN-3017` — foreign-key violation. Inspect `meta.referenced`.
3. Follow the `fix` field. For data-shape errors, fix the data; for config errors, fix the runtime config (`prisma-next-runtime`).

## Capability isn't available

`returning()`, `includeMany`, and other capability-gated features require explicit opt-in in `prisma-next.config.ts`:

```typescript
import { definePnConfig } from '@prisma-next/postgres/config';

export default definePnConfig({
  // ...
  capabilities: {
    returning: true,
    includeMany: true,
  },
});
```

After enabling:

```bash
pnpm prisma-next contract emit
```

Then re-run the type-check / runtime.

If the capability isn't in the type-suggestions at all, an extension that contributes it may be missing. Check `extensionPacks` (see `prisma-next-contract`).

## Migration won't apply

1. Read the envelope. Common codes:
   - `PN-MIG-2042` — hash mismatch. See [`MIGRATION.HASH_MISMATCH`](#migrationhash_mismatch).
   - `PN-MIG-2031` — destructive op refused without confirmation. Re-run with `--accept-destructive` or fix the migration to be non-destructive.
   - `PN-MIG-2025` — marker mismatch. The DB's marker isn't the migration's "from" hash. See [Drift](#drift).
   - `PN-MIG-2018` — placeholder data-transform not filled. Edit `migration.ts`, self-emit. See `prisma-next-migrations`.
2. For unknown codes, paste the envelope into `references/migration-errors.md` and follow the `fix`.

## Emit fails

Common codes:

- `PN-CONTRACT-5001` — PSL syntax error. The envelope's `meta` names the line + column. Fix the PSL.
- `PN-CONTRACT-5023` — unrecognized namespace. The contract references `pgvector.Vector(...)` but the `pgvector` extension isn't in `extensionPacks`. Add it (see `prisma-next-contract`).
- `PN-CONTRACT-5034` — conflicting extensions. Two extensions registered the same type / namespace. Inspect both and either remove one or rename one's namespace.
- `PN-CONTRACT-5042` — type-map collision. A field maps to two different TS types via two extensions. Disambiguate in the contract.

## Drift

Symptom: `db verify` reports drift. The DB doesn't match the marker.

1. Inspect what's different:

   ```bash
   pnpm prisma-next db schema     # live DB
   pnpm prisma-next migration show <latest-migration>  # what should be applied
   ```

2. Decide direction:
   - **DB is right, contract is wrong** → edit PSL to match, emit, `db sign`.
   - **Contract is right, DB is wrong** → `migration plan` to catch up the DB, or apply manual SQL and `db sign` after.

3. Re-verify:
   ```bash
   pnpm prisma-next db verify
   ```

See `prisma-next-migrations` for the recovery workflows in detail.

## `MIGRATION.HASH_MISMATCH`

Cause: `migration.ts` was edited after the initial emit; `ops.json` is now stale.

Fix:

```bash
node migrations/<dir>/migration.ts   # self-emit
pnpm prisma-next migration apply
```

See `prisma-next-migrations` for the broader context.

## Planner conflicts

Symptom: `migration plan` produces a destructive plan you didn't expect. E.g. dropping + adding a column you intended to rename.

Cause: the rename wasn't hinted. Fix in the contract:

```prisma
// Before:
model User {
  emailAddress String @unique
}

// After:
model User {
  emailAddress String @unique @hint(was: "email")
}
```

Re-emit, re-plan. The planner now sees the rename.

For more complex planner ambiguity (column-type changes, table splits), use `migration show <name>` to inspect what's proposed and hand-author the migration if needed (see `prisma-next-migrations`).

## How to ask for help

If the envelope's `fix` doesn't apply and the symptom doesn't match this skill's tables, the user should:

1. Run with `-v` / `--verbose` to get the full structured envelope and the underlying driver error (if any).
2. Open an issue: file a feature request via the `prisma-next-feedback` skill. Include the envelope, the contract source (sanitized), and the reproduction steps.

## Common Pitfalls

1. **Reading only the error message, not the envelope.** `why`, `fix`, and `meta` are where the recovery flow lives.
2. **Assuming an old error code's recovery applies to a new one.** Codes are stable; recoveries differ by code. Look up each one.
3. **Re-running `migration apply` after a partial failure without understanding what got applied.** Use `db schema` to see the live state before re-running.
4. **Treating drift as something to silence with `db sign`.** `db sign` accepts the current state; only run it after `db verify` shows OK.

## What Prisma Next doesn't do yet

- **Studio / GUI database browser.** Prisma Next doesn't ship a Studio equivalent. Workaround: `prisma-next db schema` for a CLI tree, or use a third-party tool (TablePlus, DataGrip, `psql`) against your `DATABASE_URL`. If you need a built-in GUI, file a feature request via the `prisma-next-feedback` skill.
- **First-class query logger middleware.** Prisma Next doesn't ship a built-in "log every query to stdout" middleware. Workaround: write a small custom middleware that wraps each operation and logs (see `prisma-next-runtime` for middleware composition). If you need a built-in query log, file a feature request via the `prisma-next-feedback` skill.
- **`EXPLAIN` integration.** Prisma Next doesn't ship a `.explain()` method. Workaround: `db.sql.raw\`EXPLAIN ANALYZE ${...}\``. See `prisma-next-queries`. If you need first-class EXPLAIN, file a feature request: file a feature request via the `prisma-next-feedback` skill.
- **Prepared-statement caching as a user-facing surface.** PN's adapters prepare under the hood for parameterized queries but you can't pre-prepare a statement and re-execute it by name. Workaround: use TypedSQL (see `prisma-next-queries`). If you need prepared statements as a first-class API, file a feature request via the `prisma-next-feedback` skill.

## Reference Files

- `references/cli-errors.md` — every `PN-CLI-4xxx` code, what it means, and how to fix it.
- `references/migration-errors.md` — every `PN-MIG-2xxx` code.
- `references/runtime-errors.md` — every `PN-RUN-3xxx` code.
- `references/contract-errors.md` — every `PN-CONTRACT-5xxx` code.
- `references/envelope-shape.md` — fields on the structured error envelope.

## Checklist

- [ ] Got the full error envelope (not just the message).
- [ ] Looked up the `code` in the matching `references/*-errors.md`.
- [ ] Followed the `fix` step from the envelope.
- [ ] Re-verified with the relevant CLI command (`db verify` / `contract emit` / `migration apply`).
- [ ] If the symptom maps to an authoring skill, chained to that skill for the actual fix.
- [ ] Did NOT confabulate a Studio / EXPLAIN / query log API — acknowledged the capability gap and pointed at the workaround + feature-request URL.
