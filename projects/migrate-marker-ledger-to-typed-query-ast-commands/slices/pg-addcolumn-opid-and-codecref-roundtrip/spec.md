# Slice — `pg-addcolumn-opid-and-codecref-roundtrip` (spec)

**Project:** migrate-marker-ledger-to-typed-query-ast-commands · **Phase:** 2 follow-up · **Linear:** [TML-2918](https://linear.app/prisma-company/issue/TML-2918)

> Two scoped Phase-2 follow-ups deferred from Slice 7 (PR [#813](https://github.com/prisma/prisma-next/pull/813)) under tracker note `task_41556b53`. Both AddColumn-local; design is settled; no spike.

## Purpose

Close the two correctness gaps Slice 7 deferred:

1. **PG `AddColumn` op ids collide across schemas.** [`op-factory-call.ts:355`](packages/3-targets/3-targets/postgres/src/core/migrations/op-factory-call.ts:355) builds `id: \`column.${tableName}.${columnName}\`` — `schemaName` is in scope but omitted. Two tables with the same name in different schemas (e.g. `public.user.email` and `audit.user.email`) collide on op id, which is the planner/runner's key for uniqueness, drift detection, and ledger entries. **Real correctness issue.**

2. **`renderDdlColumnAsTsCall` drops `codecRef`.** [`op-factory-call.ts:141`](packages/3-targets/3-targets/postgres/src/core/migrations/op-factory-call.ts:141) emits `notNull`/`primaryKey`/`default` but not `codecRef`. `DdlColumn` carries `codecRef?: CodecRef` ([ddl-types.ts:78](packages/2-sql/4-lanes/relational-core/src/ast/ddl-types.ts:78)) and the DDL walker uses it to encode literal defaults through the codec. A round-trip — render migration.ts, re-parse, re-emit — silently loses the codec mapping, and defaults fall back to raw-literal wire semantics. **Real round-trip information loss.**

## At a glance

```ts
// Item 1 — before / after at op-factory-call.ts:355
- id: `column.${tableName}.${columnName}`,
+ id: `column.${schemaName}.${tableName}.${columnName}`,  // exact separator/format follows existing op-id conventions in this file

// Item 2 — renderDdlColumnAsTsCall serializes codecRef when present
function renderDdlColumnAsTsCall(col: DdlColumn): string {
  const opts: string[] = [];
  if (col.notNull) opts.push('notNull: true');
  if (col.primaryKey) opts.push('primaryKey: true');
  if (col.default) opts.push(`default: ${renderDdlColumnDefault(col.default)}`);
+ if (col.codecRef) opts.push(`codecRef: ${renderCodecRef(col.codecRef)}`);   // new — emit when present
  return `col(${jsonToTsSource(col.name)}, ${jsonToTsSource(col.type)}${optsStr})`;
}
```

## Settled design

- **Op-id format**: include `schemaName` between the `column.` prefix and the table name. The exact separator follows the existing convention used by sibling op ids in this file — grounded at implementation. The `target:` field two lines below already uses schema, so this is just propagating the same identity into the id string.
- **`codecRef` serializer**: emit `codecRef` as a TS option when present on the `DdlColumn`. `col()`'s `DdlColumnOptions` already accepts it via spread, so the round-trip lands without changes to the factory signature. Exact TS shape (object literal vs constructor call) follows the existing `CodecRef` rendering conventions in the file — grounded at implementation.

## Non-goals

- **AddColumn-local only.** Do not retrofit other Call classes (`DropColumnCall`, etc.) with the schema-namespaced id pattern in this slice — their op-id formats and call sites are different scope. If they share the same defect, surface it as a follow-up and ship them as a separate sweep.
- **No change to `col()` / `DdlColumn` / `CodecRef` types.** Both already support `codecRef`; this slice only updates the renderer.
- **No `ops.json` format change** beyond the new op id namespace. The serialized `id` strings for AddColumn ops will change for fixtures whose AddColumn ops live in non-default schemas — those fixtures regenerate, ops.json byte-stability is not a constraint here (the id format itself is the bug fix).
- **No new tests for Slice 7's existing behavior** beyond what these two fixes require.

## Cross-cutting requirements

- **Round-trip identity.** A new test pins `parse(renderTypeScript(call)) ≡ call` for an `AddColumnCall` carrying a `DdlColumn` with `codecRef` set — round-trip equivalence is the actual correctness property the second fix delivers.
- **Op-id uniqueness across schemas.** A test pins that two `AddColumnCall`s with identical `tableName`+`columnName` but different `schemaName` produce distinct op ids.
- **Existing tests update only where the id format moved them.** Don't expand scope into adjacent assertions.
- **`pnpm fixtures:check`** regenerates any example whose AddColumn op id changes; commit the regen.
- **Green main between slices.**

## Definition of Done

- [ ] Team-DoD floor (repo gates green; Linear close-out).
- [ ] `AddColumnCall.toOp` op id includes `schemaName`; op-id-uniqueness-across-schemas test passes.
- [ ] `renderDdlColumnAsTsCall` emits `codecRef` when present; round-trip test passes for a `DdlColumn` with `codecRef`.
- [ ] `pnpm fixtures:check` clean after committing any regenerated examples.
- [ ] `pnpm lint:casts` delta ≤ 0.
- [ ] Linear issue closed; PR merged; project memory updated to mark task_41556b53 done.

## Open questions (resolved during implementation)

1. **Op-id separator format**: dot-separated `column.${schema}.${table}.${column}` (extending the existing `.`-separated pattern) vs another delimiter that mirrors sibling op ids — pick the format consistent with other PG op ids in `op-factory-call.ts`.
2. **`codecRef` TS-render shape**: literal object (`{ codecId: '...', typeParams: { ... } }`) vs a `codecRef(...)` factory call if one exists. Follow how other code in this file/package serializes a `CodecRef` (grep), or fall back to the literal-object form using `jsonToTsSource`.
3. **Do any sibling Call classes share the schema-omitted op-id defect?** Quick grep at implementation time; if so, surface as a tracked follow-up (don't expand scope).
