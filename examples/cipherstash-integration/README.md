# cipherstash-integration

End-to-end demo of [`@prisma-next/extension-cipherstash`](../../packages/3-extensions/cipherstash/README.md) — searchable application-layer field-level encryption for Postgres via the EQL bundle.

## What it shows

A `User { id, email: cipherstash.EncryptedString({ equality, freeTextSearch }) }` model authored in PSL and exercised end-to-end:

- **Insert** — write four rows; the bulk-encrypt middleware coalesces the four envelopes into one `bulkEncrypt` SDK round-trip per `(table, column)`.
- **`cipherstashEq`** — exact-match search via the EQL `eql_v2.eq` operator, lowering to the column's deterministic `unique` index.
- **`cipherstashIlike`** — bloom-filter free-text search via `eql_v2.ilike`, lowering to the column's `match` index.
- **`decryptAll`** — bulk-decrypt the result-set envelopes in one `bulkDecrypt` round-trip, then read plaintexts off the cached envelopes synchronously.

The cipherstash extension contributes its own contract space (`migrations/cipherstash/`) alongside the application schema (`migrations/<timestamp>_migration/`); `pnpm migration:apply` runs both in the same control-plane sweep.

## Layout

| Path                        | Purpose                                                                              |
| --------------------------- | ------------------------------------------------------------------------------------ |
| `prisma/schema.prisma`      | Application schema (one `User` model with one `cipherstash.EncryptedString` column). |
| `prisma-next.config.ts`     | Wires `cipherstash` into `extensionPacks`, points at the schema and migrations dir.  |
| `src/sdk.ts`                | **Demo-only** stub `CipherstashSdk`; replace with a real client.                     |
| `src/db.ts`                 | Composes `postgres()` with the cipherstash runtime descriptor + middleware.          |
| `src/index.ts`              | The demo flow (insert → eq → ilike → decryptAll).                                    |
| `src/prisma/contract.json`  | Emitted contract data.                                                               |
| `src/prisma/contract.d.ts`  | Emitted contract types.                                                              |
| `migrations/`               | Application migrations (timestamped) + the `cipherstash` extension contract space.   |

## Prerequisites

To actually run the demo (i.e. `pnpm start`) you need:

1. **A Postgres database** with the EQL bundle installed. The bundle defines the `eql_v2_encrypted` composite type, the `eql_v2_configuration` table, and the `eql_v2.*` SQL functions the operators lower to. The cipherstash extension's baseline migration installs all of this in `migrations/cipherstash/<...>_install_eql_bundle/` — `pnpm migration:apply` runs it for you.
2. **A real `CipherstashSdk` implementation.** The `src/sdk.ts` shipped here is a stub that tags plaintexts with a `ct:` prefix (so the synthetic test bundle can exercise wiring without a real ZeroKMS round-trip). It is **not** an encryption implementation — swap it out for any non-toy use.
3. **`DATABASE_URL`** in the environment (e.g. via `.env`).

The demo (`pnpm start`) runs only against (1) + (2) + (3); it cannot run as-shipped against PGlite because the EQL bundle relies on Postgres extensions PGlite does not implement.

If you only want to verify the example **typechecks and emits a contract**, run:

```bash
pnpm install
pnpm emit
pnpm typecheck
```

These steps need no database.

## Step-by-step

```bash
# Generate the contract JSON + .d.ts from prisma/schema.prisma
pnpm emit

# Generate or refresh the migration plan
pnpm migration:plan

# Apply migrations to your Postgres database (DATABASE_URL must be set)
pnpm migration:apply

# Run the demo
pnpm start
```

Expected output (against a real database with a real SDK):

```
--- Insert ---
Inserted 4 rows.

--- cipherstashEq ---
Found 1 row(s) for alice@example.com.
  user-0: alice@example.com

--- cipherstashIlike + decryptAll ---
Found 3 row(s) matching %@example.com.
  user-0: alice@example.com
  user-1: bob@example.com
  user-2: carol@example.com
```

## How it wires together

`src/db.ts` constructs a single `db` client that composes:

- the cipherstash **runtime descriptor** (`createCipherstashRuntimeDescriptor({ sdk })`) registered as an extension pack — contributes the `cipherstash/string@1` codec, the parameterized-codec descriptor, and the `cipherstashEq` / `cipherstashIlike` query operations;
- the **bulk-encrypt middleware** (`bulkEncryptMiddleware(sdk)`) registered on the runtime — intercepts `INSERT` / `UPDATE` plans and coalesces all `EncryptedString` envelopes targeting the same `(table, column)` into one `bulkEncrypt` SDK call before the wire encode runs.

Both pieces share the same SDK binding so per-tenant key material doesn't cross runtimes.

## Type-visibility for the search operators

The cipherstash extension exposes `cipherstashEq` / `cipherstashIlike` to TypeScript via the [`@prisma-next/extension-cipherstash/operation-types`](../../packages/3-extensions/cipherstash/src/exports/operation-types.ts) subpath, mirroring [`@prisma-next/extension-pgvector/operation-types`](../../packages/3-extensions/pgvector/src/exports/operation-types.ts). The contract emitter wires this through automatically (the cipherstash pack-meta declares the import in `types.queryOperationTypes`), so `src/index.ts` calls the operators directly on the column accessor (`u.email.cipherstashEq(...)`) without any cast wrapper. The accompanying `src/cipherstash-operators.types.ts` typecheck-only file pins the positive + negative AC-2 invariants (`cipherstashEq` reachable on `cipherstash/string@1` columns, unreachable on `pg/text@1` columns, and the cipherstash codec`s missing `equality` trait keeps the framework`s built-in `eq` off `email`).
