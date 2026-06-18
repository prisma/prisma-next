# psl-cst-symbol-table — Plan

**Spec:** `projects/psl-cst-symbol-table/spec.md`
**Linear Project:** [Language Tools Support Prisma Next PSL](https://linear.app/prisma-company/project/language-tools-support-prisma-next-psl-3422a7e44b9c)
**Linear Issue:** [TML-2929](https://linear.app/prisma-company/issue/TML-2929) — single issue spanning the whole project (operator decision)

## At a glance

A fully-stacked, three-slice **refactor-with-call-site-migration**: build the `buildSymbolTable` resolution layer in `@prisma-next/psl-parser`, migrate the SQL interpreter as the canary, then migrate the Mongo interpreter and delete the legacy `parsePslDocument` in the same PR. No parallelisable slices — each slice consumes the previous slice's hand-off.

## Composition

### Stack (deliver in order)

1. **Slice `build-symbol-table`** — Linear: TML-2929
   - **Outcome:** `@prisma-next/psl-parser` exports `buildSymbolTable({ document, sourceFile, scalarTypes })`, a pure, fault-tolerant resolution pass over the CST `DocumentAst` that returns the scope-aware symbol table (top-level namespaces / scalars / type-aliases / blocks / models / composite-types discriminated by `kind`; namespace-nested members keyed by name; fields nested under blocks; every symbol carrying its CST AST node) plus its own duplicate-name diagnostics list. The new dedicated duplicate-name diagnostic code exists; scalar-vs-alias classification keys off `scalarTypes`; collisions are reported regardless of `kind`, first-wins. `parsePslDocument` is untouched and still the interpreters' input.
   - **Builds on:** None — the CST `parse` already exists.
   - **Hands to:** A stable, tested `buildSymbolTable` public API + symbol-table types. This is the contract slices 2 and 3 resolve their interpreter input against. (Covers spec FR1–FR9a, NFR1–NFR2, NFR4; AC1–AC5.)
   - **Focus:** The symbol-table module + its unit tests, co-located with `parse` in `psl-parser`. In scope: the new diagnostic code added to the `PslDiagnosticCode` union. Out of scope: any interpreter change; any deletion; the legacy parser.

2. **Slice `migrate-sql-interpreter`** — Linear: TML-2929
   - **Outcome:** The SQL interpreter (`@prisma-next/sql-contract-psl`) consumes the symbol table in place of `ParsePslDocumentResult`; its `provider.ts` calls `parse` + `buildSymbolTable`; its tests build input the same way. SQL-interpreter diagnostics reach feature parity with today (codes preserved; wording/span may shift). `parsePslDocument` still exists — the Mongo interpreter and the legacy parser tests still consume it.
   - **Builds on:** Slice 1's `buildSymbolTable` API + symbol-table types.
   - **Hands to:** A proven symbol-table consumption pattern for an interpreter — the canary that surfaces any symbol-table API gap before the second interpreter fans out. Any API correction loops back into slice 1's surface within this slice. (Covers FR10, FR12 for SQL; AC6.)
   - **Focus:** `sql-contract-psl` interpreter + provider + that package's interpreter/parity tests, plus the SQL-reaching integration tests under `test/integration/` that break with the input-shape change. Out of scope: Mongo; deleting `parsePslDocument`; the printer.

3. **Slice `migrate-mongo-and-remove-legacy-parser`** — Linear: TML-2929
   - **Outcome:** The Mongo interpreter (`@prisma-next/mongo-contract-psl`) consumes the symbol table (provider + tests migrated; Mongo diagnostics at parity), and — because no consumer remains — `parsePslDocument` is removed: the function, `src/parser.ts`, its exports from `src/exports/index.ts` and `src/exports/parser.ts`, and the resolution-only machinery feeding it. Legacy parser tests (`parser.test.ts`, `parser-enum.test.ts`) are retired; the printer's round-trip tests are reworked to build the legacy `PslDocumentAst` without the removed parser. The legacy `PslDocumentAst` **types** and `printPslFromAst` stay intact.
   - **Builds on:** Slice 2's proven consumption pattern (Mongo mirrors SQL's input shape) **and** the fact that after Mongo migrates, nothing consumes `parsePslDocument` — the precondition for deletion.
   - **Hands to:** Project-DoD: one parser (`parse`) in the package; `rg parsePslDocument` clean of production references; both interpreters on the symbol table; printer/introspection green. (Covers FR11–FR15; AC7–AC10.)
   - **Focus:** `mongo-contract-psl` interpreter + provider + tests; the Mongo-reaching integration/target tests; the `psl-parser` deletion + export cleanup + README update; the printer round-trip test rework. Out of scope: touching the printer implementation or the legacy AST types.

## Dependencies (external)

- [x] **Linear tracking** — TML-2929 created under the existing "Language Tools Support Prisma Next PSL" project (operator decision: one issue for the whole project, not one per slice). All three slices reference TML-2929.

## Open items

- **Doubled qualified-name codes on over-qualified types.** An over-qualified field type (e.g. `a.b.c`) now yields both `PSL_INVALID_QUALIFIED_NAME` (native CST `parse()`, pre-existing from TML-2893) and `PSL_INVALID_QUALIFIED_TYPE` (re-derived at the SQL field-view site); legacy emitted only the latter. Accepted under FR12 (both accurate); dispatch-6 corpus asserts both. Follow-up for the operator: decide which layer owns over-qualified-name rejection and optionally collapse to one code (touches the shared CST parser, so broader than this project). Surfaced at slice-2 dispatch 5c.
- **Descriptor-typed extension-block parameters have no symbol-table home.** The legacy parser parsed declared block parameters (`ref`/`option`/`list`) descriptor-awarely at parse time; the symbol table defers all block-parameter parsing (a `BlockSymbol` carries the raw `GenericBlockDeclarationAst`). The SQL enum descriptor uses `parameters:{} + variadicParameters:true`, so slice 2 reconstructs the descriptor-free `{kind:bare|value}` path with full parity — no gap there. But any future extension block shipping a typed-parameter descriptor would need that richer parsing rehomed (into a consumer-side reconstruction, or back into `buildSymbolTable`). Slice 3 must decide where `pslBlockDescriptors`-driven validation lives, or record it as a project follow-up if no current consumer needs it. (Surfaced at slice-2 dispatch 2; confirmed out of scope for the enum seam.)
- **Exhaustive switches on `PslDiagnosticCode`.** Slice 1 added `PSL_DUPLICATE_DECLARATION` to the union. Slices 2 and 3 (which touch the interpreters and any diagnostic renderers) must verify no consumer switches exhaustively on `PslDiagnosticCode` without a default arm — a new union member silently breaks an exhaustive switch at typecheck. Surfaced by the reviewer at dispatch 1; not addressable in slice 1.

## Sequencing rationale

The stack is fully serial by necessity, not by under-parallelisation:

- **Slice 2 builds on Slice 1** — the SQL interpreter can't consume an API that doesn't exist.
- **Slice 3 builds on Slice 2 twice over.** First, Mongo's input shape mirrors SQL's, so Slice 2's proven pattern de-risks Slice 3. Second, and decisively, **`parsePslDocument` can only be deleted once *both* interpreters have stopped consuming it** — deleting in Slice 2 would break the still-legacy Mongo interpreter. The deletion therefore rides in the same PR as the Mongo migration: the moment the last consumer migrates is the moment the old path is dead code, and the spec's hard-cut intent (one parser, no dual-path interim) means it goes in the same reviewable change rather than leaving a transitional shim for a fourth slice to remove.

The SQL-first canary ordering (rather than Mongo-first) follows the spec's reference ordering and the SQL interpreter's larger surface — if the symbol-table API has a gap, the richer consumer finds it first.
