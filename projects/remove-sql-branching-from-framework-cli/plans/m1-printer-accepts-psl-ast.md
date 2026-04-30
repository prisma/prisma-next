# M1 — Printer accepts `PslDocumentAst`

**Spec:** [`../spec.md`](../spec.md) (PSL parser/printer symmetry, A6, A7)

## Goal

Rework `@prisma-next/psl-printer` so its public input is the parser's `PslDocumentAst`. Remove every SQL-flavoured type and Postgres helper from the printer's public surface. The printer no longer imports `@prisma-next/sql-schema-ir`.

By the end of this milestone:

- `printPsl(ast: PslDocumentAst): string` is the printer's only public entry point.
- The printer's internal `PrinterModel`/`PrinterField`/etc. stay as package-private intermediates.
- `validatePrintableSqlSchemaIR`, `PslPrintableSqlSchemaIR`, `PslPrintableSqlColumn`, `PslPrintableSqlTable`, the Postgres helpers, `parseRawDefault`, and `EnumInfo`/`PslPrinterOptions`/`PslTypeMap` are removed from the public surface.
- `relation-inference.ts` and `schema-validation.ts` are deleted from the printer (or their content moves to the SQL family if it's still needed there — see M2).
- `contract-infer.ts`'s old call site still uses the old API: this milestone preserves the old `printPsl(input, options)` as a temporary `@deprecated` wrapper that internally constructs an AST and calls the new path. M2 deletes the wrapper.

## Tasks

Tests are written before the implementation they cover.

### 1.0 Resolve the layering question (OQ-1)

Verify whether `framework-components` (framework / core / shared) is allowed to depend on `@prisma-next/psl-parser` (framework / authoring / migration).

**Test**: a tiny sandbox dependency added to `framework-components/package.json` followed by `pnpm lint:deps`.

If it passes: import `PslDocumentAst` directly from `@prisma-next/psl-parser` in `framework-components` (and in the printer's public types).

If it fails (likely, since `core → authoring` is upward and the rule is `upward: deny`): create `@prisma-next/psl-types` at `packages/1-framework/0-foundation/psl-types/` containing the AST types currently in `psl-parser/src/types.ts`. Update `psl-parser` and `psl-printer` to consume them from there. Update `architecture.config.json` to register the new package as `framework / foundation / shared`.

**Output of this task**: a final answer recorded in this plan (replace this task body with "Decision: …").

### 1.1 Add `printPsl(ast: PslDocumentAst): string` alongside the old API

In `packages/1-framework/2-authoring/psl-printer/src/`:

- Add a new function `printPslFromAst(ast: PslDocumentAst): string` (interim name to avoid collision with the existing export). Implementation: produce `PrinterModel[]` / `PrinterEnum[]` / `PrinterNamedType[]` directly from the AST, then reuse the existing stringification half of `print-psl.ts` unchanged.
- The transformation maps `PslModel` → `PrinterModel`, `PslField` → `PrinterField`, `PslEnum` → `PrinterEnum`, `PslNamedTypeDeclaration` → `PrinterNamedType`. Each `PslAttribute` is rendered to its string form using a new helper `renderPslAttribute(attr): string`. Derived flags (`isId`, `isRelation`, `isUnsupported`, `mapName`, `comment`) are computed from the structured attributes.

**Tests** (`packages/1-framework/2-authoring/psl-printer/test/print-psl-from-ast.test.ts`, new):
- A hand-built fixture `PslDocumentAst` containing one model with one `@id` field → `printPslFromAst` produces the expected `model X { id Int @id }` PSL.
- Same model with `@@map("foo")` → output contains `@@map("foo")`.
- An enum + a field referencing it → enum block + correct field type.
- A `types {}` block → output contains the named-type declarations.
- A model with a relation field carrying `@relation(...)` attributes → relation rendered correctly.
- Edge cases: empty model, model with only attributes, multiple enums with overlapping member names.
- A round-trip smoke test: `parsePslDocument(printPslFromAst(parsePslDocument(text).ast)).ast` is structurally equivalent to the original parse for a small representative schema. Not exhaustive (per spec Non-goals); this is one canary case.

### 1.2 Migrate the old `printPsl(input, options)` to a temporary AST-building shim

In `print-psl.ts`, replace the body of the existing exported `printPsl(schemaIR, options)` with:

```typescript
/** @deprecated Use printPslFromAst(ast) instead; this overload is removed in M2. */
export function printPsl(schemaIR: PslPrintableSqlSchemaIR, options: PslPrinterOptions): string {
  const ast = legacyInputToAst(schemaIR, options);
  return printPslFromAst(ast);
}
```

`legacyInputToAst(schemaIR, options): PslDocumentAst` is a private helper that rolls up the existing transformation logic (`processTable`, `inferRelations`, `extractEnumInfo`, default mapping, type mapping) and produces an AST. **This helper is the same logic that will move to the SQL family in M2** — it stays in the printer for M1 only as a bridge.

**Tests**:
- All existing tests in `packages/1-framework/2-authoring/psl-printer/test/` pass unchanged.
- One new equivalence test: feeding a SQL fixture through the old API and through the new API (after a separate `legacyInputToAst` call) produces identical output. (This proves the shim is a no-op observable change.)

### 1.3 Drop `@prisma-next/sql-schema-ir` from the printer

In `packages/1-framework/2-authoring/psl-printer/`:
- Move `legacyInputToAst` into a single file (`src/legacy-shim.ts`) that contains all SQL-shaped types and Postgres helpers. The rest of the printer no longer imports `sql-schema-ir`. `legacy-shim.ts` is the only file that does.
- If feasible, gate the entire shim file behind a separate dependency-cruiser exception (`legacy-shim.ts` can stay imports `sql-schema-ir` for M1 and is deleted in M2). If a clean drop is achievable in M1 by moving `legacyInputToAst` straight to the SQL family, do so and merge tasks 1.3 and M2's task 2.1.

**Decision recorded during execution**: either (a) keep the shim in the printer with a single `sql-schema-ir` import, deleted in M2, or (b) move directly to the SQL family in M1 and skip the shim entirely. Default to (b) if the SQL family scaffolding is straightforward; (a) is the safer fallback.

If (b): tasks 1.3 and M2 task 2.1 collapse, and `contract-infer.ts` is briefly broken at the M1 boundary. M2 must immediately follow.

**Tests**:
- `pnpm typecheck` from `psl-printer` package directory passes.
- `pnpm lint:deps` passes.
- Existing `psl-printer` tests pass.

### 1.4 Public-surface narrowing

Update `packages/1-framework/2-authoring/psl-printer/src/exports/index.ts`:
- Export `printPslFromAst` as `printPsl` (rename on export).
- Stop exporting: `validatePrintableSqlSchemaIR`, `PslPrintableSqlColumn`, `PslPrintableSqlSchemaIR`, `PslPrintableSqlTable`, `EnumInfo`, `PslPrinterOptions`, `PslTypeMap`, `PslTypeResolution`, `PslNativeTypeAttribute`.

If keeping the legacy shim from 1.3(a): keep the old `printPsl` overload (renamed to a deprecated alias like `printPslLegacy`) for M1 only, deleted in M2.

The `./postgres` entrypoint in `psl-printer/package.json`'s `exports` map is removed (the helpers are no longer public). Update `tsdown.config.ts` accordingly.

**Tests**:
- `pnpm build` from `psl-printer` directory succeeds.
- Importing `validatePrintableSqlSchemaIR` from `@prisma-next/psl-printer` is a TypeScript error (negative type test, or simply confirmed by `contract-infer.ts` still type-erroring before M2 lands).

### 1.5 M1 checks

- `pnpm test:packages` clean (with the temporary shim, all consumers still work).
- `pnpm lint:deps` clean.
- `psl-printer` does not import `@prisma-next/sql-schema-ir` (per A7) — modulo `legacy-shim.ts` if approach (a) is taken; that file is deleted in M2.

## Test coverage table

| Behaviour | Test type | Location |
|---|---|---|
| `printPsl(ast)` produces correct PSL for hand-built fixtures | Unit | `psl-printer/test/print-psl-from-ast.test.ts` |
| Existing SQL-input → PSL output is byte-identical via the shim | Unit (existing) | `psl-printer/test/*.test.ts` |
| `parser → printer → parser` round-trip canary | Unit | `psl-printer/test/print-psl-from-ast.test.ts` |
| Public surface narrowed | Static | TS compilation; `package.json` `exports` review |
| `psl-printer` no longer imports `sql-schema-ir` | Static | `pnpm lint:deps` and `rg` check |

## Risks and notes

- **The transformation half of `print-psl.ts` is ~600 lines.** Moving it to consume `PslDocumentAst` is real work; some of the SQL-input-specific logic (e.g. `buildFieldNamesByTable`, `seedNamedTypeRegistry`) doesn't translate directly because the input shape changes. Expect non-trivial refactoring inside the printer's transformation pipeline. The mitigation is task 1.2's equivalence test, which catches output regressions during the rework.
- **Layering decision (1.0)** is the highest-impact unknown. Starting with it minimises rework if the foundation-package option is needed.
- **`relation-inference.ts`**: in the new world, the AST already has structured relation attributes (the SQL family produces them when constructing the AST in M2). Relation inference is therefore a *family* concern — moves to the SQL family in M2. For M1, it stays inside the printer's `legacy-shim.ts` (or moves directly to the SQL family if approach 1.3(b) is taken).
