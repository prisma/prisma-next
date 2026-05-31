# @prisma-next/extension-paradedb

ParadeDB full-text search extension pack for Prisma Next.

## Overview

This extension pack registers a `'bm25'` index type with the SQL family's index-type registry, so contracts can author BM25 full-text search indexes via the standard `constraints.index(...)` surface and the Postgres adapter emits `CREATE INDEX ... USING bm25 WITH (...)` DDL.

The v1 surface covers the `key_field` storage parameter only. Per-field tokenizer and column configuration is deferred to expression-index support.

## Responsibilities

- **bm25 index registration**: declares a `'bm25'` entry via `defineIndexTypes()` carrying an arktype validator for the bm25 options shape
- **Extension descriptor**: declares the `paradedb/bm25` capability for contract-level feature detection
- **Pack ref export**: ships a pure `/pack` entrypoint for TypeScript contract authoring

## Dependencies

- **`@prisma-next/sql-contract`**: index-type registry primitive
- **`@prisma-next/contract`** / **`@prisma-next/contract-authoring`**: core contract types
- **`arktype`**: option-shape validation

## Installation

```bash
pnpm add @prisma-next/extension-paradedb
```

## Usage

### Contract definition

Author bm25 indexes via the standard `constraints.index(...)` surface; the registered `'bm25'` entry narrows `options` per-`type`:

```typescript
import { int4Column, textColumn } from '@prisma-next/adapter-postgres/column-types';
import sqlFamily from '@prisma-next/family-sql/pack';
import { defineContract, field, model } from '@prisma-next/sql-contract-ts/contract-builder';
import paradedb from '@prisma-next/extension-paradedb/pack';
import postgres from '@prisma-next/target-postgres/pack';

export const contract = defineContract({
  family: sqlFamily,
  target: postgres,
  extensionPacks: { paradedb },
  models: {
    Item: model('Item', {
      fields: {
        id: field.column(int4Column).id(),
        body: field.column(textColumn),
      },
    }).sql(({ cols, constraints }) => ({
      table: 'items',
      indexes: [
        constraints.index([cols.body], {
          name: 'item_body_bm25_idx',
          type: 'bm25',
          options: { key_field: 'id' },
        }),
      ],
    })),
  },
});
```

### key_field

ParadeDB BM25 indexes require a `key_field` — a unique column that identifies each document. It is required, must be a string, and is typically (but not always) the table's primary key.

## Capabilities

- `paradedb/bm25` — indicates support for BM25 full-text search indexes

## Authoring (maintainers)

The extension's contract + baseline migration are emitted on-disk inside this package using the same pipeline application authors use:

- `pnpm build:contract-space` — runs `prisma-next contract emit` to produce `src/contract.{json,d.ts}` from `emptyContract({ output: 'src/contract.json', target })` in `prisma-next.config.ts` (migrations-only space: no `contract.prisma` source file).
- `pnpm exec prisma-next migration plan --name <slug>` (run from this package directory) — scaffolds a new migration directory under `migrations/<dirName>/` for schema changes. **Not chained into `pnpm build`**: `migration plan` is non-idempotent (each invocation generates a new timestamped directory), so it runs manually when the contract changes. Note: paradedb's contract declares no tables or models, so the planner currently refuses to scaffold the baseline migration (this is **Path B** authoring per [ADR 212](../../../docs/architecture%20docs/adrs/ADR%20212%20-%20Contract%20spaces.md#contract-space-package-layout)). That directory was hand-authored once (Migration subclass + seed `migration.json` preserving the full `toContract`) and `pnpm tsx migrations/<dirName>/migration.ts` re-emits `ops.json` + `migration.json` deterministically. Future migrations that add tables or models can use `migration plan` directly (Path A).
- `pnpm tsx migrations/<dirName>/migration.ts` (run from this package directory) — re-emits `ops.json` + `migration.json` from the hand-edited subclass. Use `tsx`, not bare `node`, because the Migration subclass imports relative TypeScript siblings which Node's native loader can't resolve without a TS-aware loader.
- `migrations/refs/head.json` is hand-pinned with the latest migration's `to` hash + `providedInvariants`.

The descriptor at `src/exports/control.ts` then JSON-imports those artefacts and synthesises the framework's `MigrationPackage` shape.

See [ADR 212 — Contract spaces](../../../docs/architecture%20docs/adrs/ADR%20212%20-%20Contract%20spaces.md) ("Contract-space package layout") for the canonical layout and rationale.

## Not yet implemented

- Per-column / per-expression tokenizer configuration (deferred to expression-index support)
- `@@@` operator and `pdb.*` query builder functions
- Scoring, aggregation, and highlight functions

## References

- [ParadeDB documentation](https://docs.paradedb.com/)
- [ParadeDB CREATE INDEX](https://docs.paradedb.com/documentation/indexing/create-index)
- [ADR 210 — Index-type registry](../../../docs/architecture%20docs/adrs/ADR%20210%20-%20Index-type%20registry.md)
- [ADR 212 — Contract spaces](../../../docs/architecture%20docs/adrs/ADR%20212%20-%20Contract%20spaces.md)
- [Prisma Next Architecture Overview](../../../docs/Architecture%20Overview.md)
