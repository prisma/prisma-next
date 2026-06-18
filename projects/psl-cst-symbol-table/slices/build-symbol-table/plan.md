## Dispatch plan

**Slice spec:** `projects/psl-cst-symbol-table/slices/build-symbol-table/spec.md`
**Linear:** TML-2929

**Validation gate (both dispatches):** `pnpm typecheck` + `pnpm test:packages` (scoped to `@prisma-next/psl-parser`) + `pnpm lint:deps`. Dispatch 1 additionally runs `pnpm build` for `@prisma-next/framework-components` so the new `PSL_DUPLICATE_DECLARATION` literal is visible to the parser package's typecheck.

### Dispatch 1: types-and-diagnostic-code

- **Outcome:** The symbol-table types (`SymbolTable`, `TopLevelScope`, the per-kind symbol interfaces `NamespaceSymbol` / `ModelSymbol` / `CompositeTypeSymbol` / `BlockSymbol` / `ScalarSymbol` / `TypeAliasSymbol` / `FieldSymbol`, `BuildSymbolTableOptions`, `SymbolTableResult`) exist in a new module in `@prisma-next/psl-parser` and are exported from the package's `src/exports/` surface; `PSL_DUPLICATE_DECLARATION` is a member of the `PslDiagnosticCode` union in `framework-components`, which is rebuilt. `buildSymbolTable` may exist as an unimplemented signature stub (no logic). Typecheck + `lint:deps` green; no builder tests yet.
- **Builds on:** The spec's chosen design (the keyed-record + discriminated-`kind` + `.node`-on-every-symbol shape) and the existing CST AST node classes + `ParseDiagnostic`/`SourceFile`.
- **Hands to:** The exported symbol-table type surface and the new diagnostic code — the stable contract the builder's tests are written against in dispatch 2.
- **Focus:** Type definitions, the new module file, exports, the one-line `PslDiagnosticCode` union addition, and the `framework-components` rebuild. No resolution logic; no interpreter touch; nothing deleted.

### Dispatch 2: builder-and-tests

- **Outcome:** `buildSymbolTable({ document, sourceFile, scalarTypes })` is fully implemented — iterates `DocumentAst.declarations()` and `NamespaceDeclarationAst.declarations()`, classifies `types {}` bindings as scalar vs type-alias against `scalarTypes`, populates the keyed records, and emits `PSL_DUPLICATE_DECLARATION` (first-wins, collide-regardless-of-kind, per-scope name set) without ever throwing. Unit tests written first (per the repo's test-before-impl rule) cover project-spec AC1–AC5: fault-tolerance on malformed input, top-level kind discrimination + scalar/alias classification, namespace nesting, field nesting + node back-reference, and same-scope duplicate collision. Full gate green.
- **Builds on:** Dispatch 1's exported symbol-table type surface + `PSL_DUPLICATE_DECLARATION`.
- **Hands to:** Slice-DoD — a tested, exported `buildSymbolTable` that slice 2 (`migrate-sql-interpreter`) consumes. README note for the new public API landed.
- **Focus:** The resolution logic + its unit tests + the README note. No interpreter change; no qualified-type-reference resolution (stays in interpreters per the spec); no deletion.
