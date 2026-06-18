## Dispatch plan

**Slice spec:** `projects/psl-cst-symbol-table/slices/resolve-in-symbol-table/spec.md`
**Linear:** TML-2929

**Validation gate:** per-dispatch `pnpm --filter <pkg> typecheck` + `pnpm --filter <pkg> test` + `pnpm lint:deps`; slice DoD = workspace-wide `pnpm build` + `pnpm typecheck` + `pnpm test:packages` + `pnpm lint:deps`, diagnostic codes preserved.

### Dispatch 1: resolve-in-symbol-table

- **Outcome:** `buildSymbolTable` resolves once. `FieldSymbol` gains `typeName`/`typeNamespaceId`/`typeContractSpaceId`/`optional`/`list`/`typeConstructor?`/`attributes`/`malformedType?`; `ScalarSymbol`/`TypeAliasSymbol` gain the resolved binding shape (`baseType`/`typeConstructor`/`isConstructor`); shared `ResolvedAttribute`/`ResolvedTypeConstructorCall` (+ `Range→PslSpan` map + attribute-render helper) live in `@prisma-next/psl-parser` and are exported. Over-qualified types emit `PSL_INVALID_QUALIFIED_TYPE` from the symbol table with `malformedType` set. Resolution logic is ported from the SQL/Mongo `cst-read.ts`/`symbol-views.ts` (proven). psl-parser symbol-table tests cover the resolution. The view layers still exist in the interpreter packages (deleted in D2/D3) — psl-parser is green and the new resolved shape is exported.
- **Builds on:** The merged project (`buildSymbolTable`, the CST AST, the existing SQL/Mongo resolution to port).
- **Hands to:** Resolved `FieldSymbol`/`ScalarSymbol`/`TypeAliasSymbol` exported from psl-parser — the shape both interpreters consume directly in D2/D3.
- **Focus:** `symbol-table.ts` + the moved span/attribute helpers + tests. No interpreter change yet.

### Dispatch 2: sql-consume-resolved-delete-views

- **Outcome:** The SQL interpreter + helpers read the resolved `FieldSymbol`/`ScalarSymbol`/`TypeAliasSymbol` fields directly; `cst-read-views.ts` + `symbol-views.ts` deleted; `cst-read.ts` trimmed to nothing-or-package-specific; the `typeAlreadyReported` cascade-suppression now keys off `FieldSymbol.malformedType`. SQL `contract-psl` suite green, all diagnostic codes preserved.
- **Builds on:** D1's resolved symbol shape.
- **Hands to:** The SQL package off the view layer — the proven pattern Mongo mirrors.
- **Focus:** SQL `contract-psl` src helpers + interpreter walk + the deletions + tests. `enum-block.ts` re-pointed only if it imported a moved helper.

### Dispatch 3: mongo-consume-resolved-delete-views

- **Outcome:** Same as D2 for Mongo: helpers read resolved symbol fields; `cst-read-views.ts` + `symbol-views.ts` + the Mongo `cst-read.ts` view portion deleted; Mongo suite green, codes preserved.
- **Builds on:** D1's resolved shape + D2's proven rewire pattern.
- **Hands to:** Both interpreters off the view layer; the duplication gone.
- **Focus:** Mongo `contract-psl` src + tests + deletions.

### Dispatch 4: slice-dod-sweep

- **Outcome:** Slice DoD: `rg 'CstFieldView|CstModelView|CstCompositeTypeView|CstNamedTypeView|buildFieldView' packages/2-sql packages/2-mongo-family` empty; workspace-wide gate green (`pnpm build` + `pnpm typecheck` + `pnpm test:packages` + `pnpm lint:deps`); diagnostic codes preserved across SQL + Mongo suites. Any straggler import of a deleted view fixed.
- **Builds on:** D1–D3.
- **Hands to:** Slice complete — resolution centralized, views gone.
- **Focus:** The repo-wide grep + the full gate + any cleanup the workspace build surfaces.
