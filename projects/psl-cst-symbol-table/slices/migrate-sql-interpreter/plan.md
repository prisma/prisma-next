## Dispatch plan

**Slice spec:** `projects/psl-cst-symbol-table/slices/migrate-sql-interpreter/spec.md`
**Linear:** TML-2929

**Validation gate (all dispatches):** `pnpm --filter @prisma-next/sql-contract-psl typecheck` + `pnpm --filter @prisma-next/sql-contract-psl test` + `pnpm lint:deps`. Build upstream packages first if a fresh worktree reports stale dists (per slice-1 learnings). Final dispatch additionally runs the slice-DoD grep gate.

Dispatches are sequential; each builds on the prior's hand-off. Test files migrate alongside the helper they exercise where natural, with a final sweep dispatch for the remainder.

### Dispatch 1: cst-read-adapters

- **Outcome:** Package-local adapters exist and are unit-tested: (a) a type-annotation splitter `FieldDeclarationAst → { typeName, typeNamespaceId, typeContractSpaceId, optional, list, isConstructor, path }` derived from `QualifiedNameAst` (incl. `isOverQualified()` → the malformed-qualified-type diagnostic), and (b) an attribute reader `FieldAttributeAst`/`ModelAttributeAst → { name, args:[{kind,value,span}] }` rendering `ExpressionAst → string`. No interpreter wiring yet.
- **Builds on:** Slice 1's `SymbolTable` (the `.node` CST classes) and the spec's prescriptive derivation.
- **Hands to:** A stable CST-read surface the helper rewrites (dispatch 3) and the interpreter walk (dispatch 4) consume in place of legacy `PslField`/`PslAttribute` field access.
- **Focus:** New adapter module(s) + their tests. No change to existing helpers yet.

### Dispatch 2: enum-block-reconstruction

- **Outcome:** A reconstruction that turns a `BlockSymbol` (`keyword: 'enum'`, raw `GenericBlockDeclarationAst`) into the `PslExtensionBlock`-shaped `{ name, blockAttributes, parameters, span }` the downstream `2-sql/9-family` enum factory consumes — parsing `@@type(...)` from `node.attributes()` and members from `node.entries()`. Unit-tested against the factory's read set. The factory contract is unchanged.
- **Builds on:** Dispatch 1's attribute reader (for `@@type`).
- **Hands to:** An enum-block adapter the interpreter walk (dispatch 4) calls where it currently calls `namespacePslExtensionBlocks(ns).filter(b => b.kind === 'enum')`.
- **Focus:** The highest-risk seam, isolated. No interpreter wiring yet; just the reconstruction + tests proving parity with the factory's expectations.

### Dispatch 3: helper-rewrite

- **Outcome:** The leaf helpers (`psl-attribute-parsing`, `psl-authoring-arguments`, `psl-column-resolution`, `psl-relation-resolution`, `psl-field-resolution`) consume symbol-table entries + the dispatch-1 adapters instead of legacy `Psl*` objects; named-type resolution takes `scalars + typeAliases` re-unioned with the `isConstructor()` discriminant. Package typecheck green for these files (the interpreter entry may still be mid-migration but must compile).
- **Builds on:** Dispatch 1's adapters; dispatch 2's enum reconstruction (for any helper that touches enum descriptors).
- **Hands to:** Helpers that no longer import legacy `Psl*` types — the interpreter entry can now be rewired against them.
- **Focus:** The five helper files + named-type re-union. Behaviour-preserving; diagnostic codes unchanged.

### Dispatch 4: interpreter-walk-and-input

- **Outcome:** `interpretPslDocumentToSqlContract`'s input type is the `SymbolTable` (+ `target`/`scalarTypeDescriptors`/`authoringContributions`/`sourceId`); the entry walks `topLevel` + per-`NamespaceSymbol` instead of `document.ast.namespaces`/`.compositeTypes`/`.types.declarations`; enum-in-namespace still emits `PSL_ENUM_NAMESPACE_NOT_SUPPORTED`. Package typecheck green; legacy `Psl*`/`parsePslDocument` imports gone from `src/` except the provider (dispatch 5).
- **Builds on:** Dispatches 1–3 (adapters, enum reconstruction, rewritten helpers).
- **Hands to:** A fully symbol-table-driven interpreter entry; only the provider still calls the legacy parser.
- **Focus:** `interpreter.ts` entry + input type + namespace/composite/named-type/enum traversal.

### Dispatch 5: provider-parse-swap

- **Outcome:** `provider.ts` calls `parse(schema)` + `buildSymbolTable({ document, sourceFile, scalarTypes: [...context.scalarTypeDescriptors.keys()] })` and feeds the table to the interpreter, surfacing both diagnostic lists; `pslBlockDescriptors` rehomed or carried as an Open item per the spec. `rg 'parsePslDocument' packages/2-sql/2-authoring/contract-psl/src` returns nothing.
- **Builds on:** Dispatch 4's symbol-table interpreter input.
- **Hands to:** A production SQL path fully off `parsePslDocument`. (Mongo + the legacy parser deletion remain slice 3.)
- **Focus:** `provider.ts` only.

### Dispatch 5b: enum-member-duplicate-parity

- **Outcome:** A duplicate enum member (the same member name declared twice in an `enum {}` block) again produces `PSL_EXTENSION_DUPLICATE_PARAMETER` — the validation the legacy `pslBlockDescriptors`-driven parser performed, lost when dispatch 5 dropped the descriptor thread. `reconstructExtensionBlock` (dispatch 2's `enum-block.ts`) gains a diagnostics sink + sourceId and emits the existing code (span from the duplicate entry's `.node`) where it currently drops the duplicate first-wins silently; the interpreter walk threads its diagnostics array into the call site.
- **Builds on:** Dispatch 2's `reconstructExtensionBlock` and dispatch 4's interpreter walk.
- **Hands to:** Full diagnostic parity for enum blocks — so the dispatch-6 fan-out lands on a genuinely-green suite (the `interpreter.enum.test.ts` duplicate-member assertion passes).
- **Focus:** `enum-block.ts` (sink + emit) + the one walk call site in `interpreter.ts` that calls it. Preserve the existing code `PSL_EXTENSION_DUPLICATE_PARAMETER`; first-wins resolution unchanged (only the now-emitted diagnostic is added). No provider/Mongo/9-family touch.

### Dispatch 5c: combined-diagnostic-surfacing

- **Outcome:** The SQL provider matches the legacy combined-set behaviour (operator decision E1): instead of failing before interpreting when `parse`/`buildSymbolTable` produce diagnostics, it **seeds** those diagnostics into the interpreter's collection, interprets the recovered document, and returns the deduped parse + symbol-table + interpreter union in one run. The interpreter walk must NOT emit *spurious* diagnostics about content the symbol table dropped first-wins (the other half of FR12) — a dropped duplicate must not make the interpreter complain about a now-missing declaration beyond what the legacy recovered-AST walk produced.
- **Builds on:** Dispatch 5's two-list collection + `mapParseDiagnostics`; dispatch 4's interpreter entry (which gains a diagnostic-seed input).
- **Hands to:** The AC6 parity behaviour the dispatch-6 corpus encodes — combined diagnostics in one provider run.
- **Focus:** `provider.ts` (replace short-circuit with seed-and-combine) + the interpreter entry's diagnostic-seed input thread. A test asserts a schema with both a parse/symbol-table error and an interpreter error surfaces both in one run. No Mongo/9-family touch.

### Dispatch 6: test-migration-and-dod

- **Outcome:** A shared test helper (`parse` → `buildSymbolTable` → interpret) replaces the 160 inline `parsePslDocument` calls across the 14 test files; the hand-built-`ParsePslDocumentResult` test in `interpreter.diagnostics.test.ts` is rewritten against the symbol-table input. The full SQL `contract-psl` suite is green with diagnostic **codes** unchanged from pre-migration. Slice-DoD grep gate passes (`rg 'PslModel|PslField|PslCompositeType|PslNamedTypeDeclaration|PslExtensionBlock|parsePslDocument' …/src` empty).
- **Builds on:** Dispatches 1–5 (the full migrated production surface).
- **Hands to:** Slice-DoD — SQL interpreter proven on the symbol-table input; the canary's findings (any `buildSymbolTable` API gaps) resolved. Hands the proven consumption pattern to slice 3 (Mongo).
- **Focus:** Test fan-out + the coupled-test rewrite + the final grep gate. Mechanical apart from the one hand-built-AST test.

### Dispatch 6b: restore-unknown-top-level-block-rejection

- **Outcome:** The SQL interpreter walk re-emits `PSL_UNSUPPORTED_TOP_LEVEL_BLOCK` for any `BlockSymbol` whose `keyword` is neither a framework built-in nor present in the composed contributions (re-threading `authoringContributions.pslBlockDescriptors` / composed entity contributions into the walk for this gate). This restores the strictness the descriptor-driven legacy parser enforced and the descriptor-agnostic CST parser dropped (operator decision E2). The two dispatch-6 tests (`datasource db {}` unknown block; `enum` with no descriptors composed) pass with their ORIGINAL `PSL_UNSUPPORTED_TOP_LEVEL_BLOCK` assertions — unchanged. Resolves project Open Question #1 (`pslBlockDescriptors` rehomes to the interpreter walk, not the parser).
- **Builds on:** Dispatch 4's interpreter walk + dispatch 6's fanned-out tests.
- **Hands to:** Slice-2 DoD — full SQL suite green, strictness parity restored. Hands slice 3 the settled answer that `pslBlockDescriptors` validation lives interpreter-side.
- **Focus:** `interpreter.ts` walk gate + the `authoringContributions` thread for the allowed-keyword source. Match the legacy code + message substance. No parser change; no Mongo/9-family.

