# Brief: D5 — Address reviewer findings on slice 5

The slice-DoD reviewer pass returned `ANOTHER ROUND NEEDED` with four findings. Three must-fix / should-fix items go in this dispatch; one finding is deferred to a follow-up with a cross-link comment.

## F1 — Renderer's literal-default handling drifts from the pre-slice format for `boolean`, `Date`, and `bigint`

**Where:** `packages/3-targets/6-adapters/sqlite/src/core/ddl-renderer.ts` ~lines 79–95 (the `defaultVisitor.literal` body); `packages/3-targets/3-targets/sqlite/src/core/migrations/planner-ddl-builders.ts` ~lines 77–94 (the pre-slice `renderDefaultLiteral` oracle).

`ColumnDefault.literal.value` is typed as `ColumnDefaultLiteralInputValue = JsonValue | Date` (`packages/1-framework/0-foundation/contract/src/types.ts` ~line 104), so the renderer must handle every kind that reaches it. Today's drift:

- `boolean true / false` → renderer emits `DEFAULT true / DEFAULT false`. Pre-slice emitted `DEFAULT 1 / DEFAULT 0`. SQLite has no boolean type so functionally equivalent in practice, but the slice DoD says **byte-identical** to pre-slice output.
- `Date` → falls through to the final branch `\`DEFAULT '${JSON.stringify(value)}'\``, which serialises a Date as `'"2025-...Z"'` (double-quoted ISO inside single quotes — invalid SQL).
- `bigint` → `JSON.stringify(bigint)` throws.

**Fix:** Extend the `defaultVisitor.literal` body to match `renderDefaultLiteral`'s output exactly across all `ColumnDefaultLiteralInputValue` shapes. Read `renderDefaultLiteral` and mirror it. Keep the existing `string` / `number` / `null` paths; add explicit `boolean` (→ `0` / `1`) and `Date` (→ `'${ISO}'`) and `bigint` (→ `String(value)`) handling before the JSON-stringify fallback.

**Pin:** update `packages/3-targets/6-adapters/sqlite/test/ddl-create-table-lowering.test.ts` line ~42 which currently asserts `DEFAULT true` — change to `DEFAULT 1`. Add a new test in that file pinning the Date and bigint cases.

## F2 — Byte-parity test's oracle compares the renderer to itself

**Where:** `packages/3-targets/6-adapters/sqlite/test/migrations/create-table-call-byte-parity.test.ts` lines ~27–49.

The current `oracleSql` calls `buildCreateTableDdl(...)` and then `renderLoweredDdl(node).sql` — the same renderer the new path calls through the lowerer. So the test asserts `newPath === renderer(node) === renderer(node)`, which only proves `CreateTableCall.toOp` adds no transformation on top of the renderer. The cross-implementation check the spec named the test for is gone, which is exactly what let F1's drift slip through.

The free `createTable(tableName, spec)` + `renderCreateTableSql` still live in `packages/3-targets/3-targets/sqlite/src/core/migrations/operations/tables.ts` (kept on disk for `recreateTable`'s Phase 2 use; only the facade re-export was dropped). They're a valid pre-slice oracle.

**Fix:** Replace `oracleSql` with a `pre-slice oracle` that imports the free `createTable` and `renderCreateTableSql` directly from the internal module path (not via the facade): `import { createTable as preSliceCreateTableOp } from '../../../../3-targets/sqlite/src/core/migrations/operations/tables'`. The oracle calls `preSliceCreateTableOp(tableName, tableSpec).execute[0].sql` where `tableSpec` is a `SqliteTableSpec` carrying the same content as the `DdlColumn[]` / `DdlTableConstraint[]` the new-path test uses. Each test case provides both representations (the `SqliteTableSpec` for the oracle, the `DdlColumn[]` for the new path) — they're not derived from each other.

**Extend coverage** to include columns with each literal-default kind from `ColumnDefaultLiteralInputValue`: string, number, boolean, null, Date, JSON object/array, bigint. The current 5 representative shapes (simple, composite PK, FK, unique, autoincrement) stay; add column-default-kind cases as new `it(...)` blocks. The autoincrement-inline-PK case is fine to keep but doesn't exercise the structural-default → renderer path that F1 surfaces.

## F3 — `autoincrement()` magic string handled in renderer, not in `sqliteDefaultToDdlColumnDefault`

**Where:** `packages/3-targets/3-targets/sqlite/src/core/migrations/issue-planner.ts` — the `sqliteDefaultToDdlColumnDefault` helper.

Today: helper constructs `new FunctionColumnDefault('autoincrement()')` and relies on the renderer's `function` visitor to recognise the magic string and return `''`. PG's analogue at `packages/3-targets/3-targets/postgres/src/core/migrations/op-factory-call.ts:104` skips the autoincrement-default at the helper boundary (`if (columnDefault.expression === 'autoincrement()') return undefined`). Mirror PG.

**Fix:** Add the same guard at the top of `sqliteDefaultToDdlColumnDefault`'s `case 'function':` branch:

```ts
case 'function':
  if (columnDefault.expression === 'autoincrement()') return undefined;
  return new FunctionColumnDefault(columnDefault.expression);
```

The renderer's defensive `autoincrement()` check at `ddl-renderer.ts` ~line 97 stays (belt-without-suspenders). No test changes; the current behaviour is preserved (zero `DEFAULT (autoincrement())` emitted).

## F4 — `DdlColumn.type` smuggling channel for `PRIMARY KEY AUTOINCREMENT`

**Where:** `packages/3-targets/3-targets/sqlite/src/core/migrations/issue-planner.ts` ~lines 300–302 (`tableToDdlParts`); `packages/3-targets/6-adapters/sqlite/src/core/ddl-renderer.ts` ~lines 104–107 (`renderColumn`'s substring detection).

The inline-autoincrement column constructs `new DdlColumn({ type: \`${typeSql} PRIMARY KEY AUTOINCREMENT\` })` — embeds column-level options into the type string. The renderer substring-detects and special-cases the rendering. This is a real cross-IR smell (`DdlColumn.type` is documented as the DDL type token), but the structural fix (add a SQLite-specific column-level autoincrement flag to `DdlColumn` or to a SQLite-target subclass) is cross-target IR work that exceeds the slice's scope.

**Fix in this dispatch:** add a cross-linking comment at BOTH sites (`tableToDdlParts:300-302` AND `renderColumn:104-107`) naming the convention so it doesn't outlive itself silently. The comment should describe the SITUATION (what's smuggled, why both sides need to know) without referring to any project orchestration or dispatch IDs.

**Deferred (not in this dispatch):** file a follow-up ticket "SQLite inline-autoincrement: stop smuggling column options through `DdlColumn.type`" — recorded in the orchestrator notes; the structural fix designs a SQLite-specific column-level option surface and migrates both sites onto it.

## Scope

**In:** all four findings as described above. Net effect: ~3 source files + ~2 test files modified.

**Out:**
- The structural fix for F4 (defer to follow-up).
- Any other `*Call`, `SqliteMigration`, facade, or upgrade-instructions changes.
- PG / Mongo / non-SQLite surface.

## Completed when

- [ ] `defaultVisitor.literal` emits the pre-slice format for boolean / Date / bigint (`0`/`1`, ISO single-quoted, `String(bigint)`).
- [ ] Byte-parity test's oracle imports `createTable` + `renderCreateTableSql` from `operations/tables.ts` (the internal module path, NOT via the facade) and uses them as a true cross-implementation oracle; new test cases cover string / number / boolean / null / Date / JSON-object / bigint literal defaults.
- [ ] `sqliteDefaultToDdlColumnDefault` short-circuits `autoincrement()` to `undefined`.
- [ ] Cross-linking comments added at both `tableToDdlParts` and `renderColumn` autoincrement sites.
- [ ] `pnpm --filter @prisma-next/target-sqlite typecheck + test` green.
- [ ] `pnpm --filter @prisma-next/adapter-sqlite typecheck + test` green.
- [ ] `pnpm --filter @prisma-next/sqlite typecheck + test` green.
- [ ] `pnpm fixtures:check` green.

## Standing instruction

Stay focused; control scope. Trivial-related fixes serving the goal in the same commit with a one-line note; drift halts.

## Halt conditions

- The boolean / Date / bigint format change breaks an existing test that wasn't in the F1 set — surface; do not silently expand scope.
- The byte-parity oracle import from `operations/tables.ts` requires changing that module's exports — surface; the free `createTable` and `renderCreateTableSql` are already exported (the slice spec said they STAY).
- More than 5 files touched — surface; the change should be ~3 source + 2 test.

## References

- **Reviewer report** transcript is in the prior orchestrator turn; the four findings above are paraphrases of the verbatim findings 1, 2, 3, 4.
- **Pre-slice oracle:** `packages/3-targets/3-targets/sqlite/src/core/migrations/planner-ddl-builders.ts` (`renderDefaultLiteral`) + `packages/3-targets/3-targets/sqlite/src/core/migrations/operations/tables.ts` (`createTable` + `renderCreateTableSql`).
- **PG analogue for F3:** `packages/3-targets/3-targets/postgres/src/core/migrations/op-factory-call.ts:104`.
- **`ColumnDefaultLiteralInputValue` type** at `packages/1-framework/0-foundation/contract/src/types.ts` ~line 104.

## Operational metadata

- **Model tier:** sonnet — focused fix dispatch.
- **Time-box:** 60 minutes.

## Repo standing constraints

- Worktree: `/Users/wmadden/Projects/prisma/prisma-next/.claude/worktrees/adoring-swartz-9d66c0`.
- `pnpm`, never `npm`/`npx`.
- No bare `as` casts in production code; tests exempt.
- No TS import file extensions.
- **No transient project references in code / comments / test names** — describe behaviour, not orchestration. Don't write `// D5` / `// F1` / `it('… (TML-NNNN)')` / `"matches the pre-#NNN behaviour"`. Name the property. The cross-linking comments for F4 describe the SITUATION (what's smuggled), not the orchestration.
