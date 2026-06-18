# Slice: migrate-mongo-and-remove-legacy-parser

_Parent project: `projects/psl-cst-symbol-table/`. Outcome this slice contributes: the Mongo interpreter consumes the symbol table, every repo consumer is off `parsePslDocument`, and the legacy parser is deleted — closing the project (AC7–AC10)._

## At a glance

Migrate `@prisma-next/mongo-contract-psl` onto the symbol table (mirroring the proven SQL pattern), rewire the four out-of-package SQL consumers slice 2 left broken, rework the printer's round-trip tests off `parsePslDocument`, then delete `parsePslDocument` (the `src/parser.ts` implementation, its exports, and the two legacy parser test files) — once nothing consumes it. The legacy `PslDocumentAst` **types** stay (the printer imports them from `framework-components`); only the legacy parser function + its private implementation + its own tests go.

## Chosen design

### 1. Mongo interpreter migration (mirrors SQL, smaller)

The Mongo interpreter is a strict subset of SQL's coupling: it has **no** namespaces (rejects explicit `namespace {}`), **no** enums/extension blocks, **no** named-type/`types {}` bindings, **no** type constructors. It has models, composite types, fields, attributes, and polymorphism (`@@discriminator`/`@@base`). So it needs a **trimmed** adapter set — `readFieldTypeAnnotation` + `readAttribute` + the span maps + `buildModelView`/`buildCompositeTypeView`/`buildFieldView` + the `CstModelView`/`CstFieldView`/`CstCompositeTypeView`/`CstAttributeView` interfaces — but **not** `reconstructExtensionBlock`, `readConstructorCall`, `buildNamedTypeView`, or the named-type-resolution helper.

**Adapter sourcing decision:** Mongo gets its **own package-local copy** of the trimmed adapters, matching the current package-local convention (the SQL adapters are private to `@prisma-next/sql-contract-psl`, not exported). Extracting a shared `psl-cst-read` package would reopen the already-shipped SQL package and force a layering decision (`lint:deps`) — out of proportion for this slice. The ~3 small duplicated adapter files are the cheaper trade; a shared-extraction follow-up is recorded as a project Open item, not done here.

The interpreter entry input changes from `{ document: ParsePslDocumentResult; scalarTypeDescriptors; codecLookup }` to `{ symbolTable; sourceFile; sourceId; scalarTypeDescriptors; codecLookup }`; the six `document.ast.*` walks (top-level models/composite-types, the namespace-block rejection, the two polymorphism `flatMap` scans) retarget onto `SymbolTable.topLevel`. `psl-helpers.ts` retargets onto `CstAttributeView`. The provider mirrors SQL's: `parse` + `buildSymbolTable({ document, sourceFile, scalarTypes: [...scalarTypeDescriptors.keys()] })` + combined-diagnostic seeding via `mapParseDiagnostics` (the same combined-set behaviour decision E1 settled for SQL — Mongo must match it for cross-target consistency).

### 2. SQL stragglers (slice-2 escapee fix)

Four out-of-package consumers still call `interpretPslDocumentToSqlContract({ document: parsePslDocument(...) })` against the pre-slice-2 signature and are currently red: `test/integration/test/authoring/parity/ts-psl-parity.real-packs.test.ts`, `packages/3-extensions/postgres/test/psl-namespace-qualifier-routing.test.ts`, `test/integration/test/authoring/psl-index-type-options.integration.test.ts`, and the SQL half of `test/integration/test/value-objects/value-objects.integration.test.ts`. Rewire each to `parse` + `buildSymbolTable` + the `{ symbolTable, sourceFile, sourceId }` input — the same rewire slice 2 applied internally. Independent of Mongo; runs first.

### 3. Printer round-trip tests (off the deleted parser)

The printer `src/` is untouched (it imports `PslDocumentAst` from `framework-components`, not the parser). Two test files round-trip via `parsePslDocument` and need a legacy-AST source that isn't the deleted parser:
- `test/print-psl-from-ast.test.ts` — the ~7 round-trip cases convert to **hand-built `PslDocumentAst` fixtures** (the file already has 17 such literals; this is consistent, in-package, no layering inversion).
- `test/declarative-policy-select.round-trip.test.ts` — **the hard one.** It exercises the legacy parser's descriptor-driven extension-block path (`pslBlockDescriptors` + `codecLookup`, policy-select discriminator, factory lowering) — which the CST `parse` does **not** reproduce (descriptor-typed block parsing has no symbol-table home; tracked project follow-up). There is no drop-in legacy-AST source for descriptor-typed blocks once `parsePslDocument` is gone. Working position: rework it to hand-built `PslExtensionBlock` AST fixtures (assert the printer renders them correctly — the printer's job is AST→text, which doesn't need the parser). **Halt-condition:** if hand-building the descriptor-typed-block AST proves to genuinely require the legacy parser's resolution (i.e. the test is really testing parse+resolve, not print), STOP and surface — retiring vs. relocating that test is an operator decision.

### 4. Delete `parsePslDocument`

Once 1–3 land and nothing consumes it: delete `src/parser.ts`, `src/exports/parser.ts`, the `parsePslDocument` export line in `src/exports/index.ts`, and the two legacy parser test files (`test/parser.test.ts`, `test/parser-enum.test.ts`). **Keep:** `src/attribute-helpers.ts` (its `parseQuotedStringLiteral` is shared with the migrated SQL package; `getPositionalArgument`'s legacy overload becomes dead but the file stays) and its test; the entire CST path (`parse.ts`, `symbol-table.ts`, `tokenizer.ts`, `source-file.ts`, `syntax/**`); the `PslDocumentAst`-family type re-exports (the printer's canonical source is `framework-components`, but prune the now-legacy-only `ParsePslDocumentInput`/`ParsePslDocumentResult` re-exports). Update the affected READMEs + ADR 163 reference (doc-maintenance).

## Coherence rationale

One PR, one outcome: "nothing in the repo uses `parsePslDocument`, and it's gone." The Mongo migration, the straggler fixes, the printer-test rework, and the deletion all serve that single end-state and must land together — deleting the parser before the last consumer migrates would break the build, and migrating the last consumer without deleting leaves the dual-path the project exists to remove. A reviewer holds it as one coherent "retire the legacy parser" change.

## Scope

**In:**
- `packages/2-mongo-family/2-authoring/contract-psl/src/**` + `test/**` (interpreter, provider, helpers, the trimmed adapters, 7 test sites).
- The 4 broken out-of-package SQL consumers.
- The 3 Mongo-side integration/target consumers (`test/integration/test/mongo/…`, `packages/3-mongo-target/…`, the value-objects integration test).
- Printer round-trip tests (2 files).
- `parsePslDocument` deletion + export prune + legacy parser test retirement in `@prisma-next/psl-parser`.
- README/ADR doc updates.

**Out:**
- The printer `src/` and the legacy `PslDocumentAst` **types** (stay — introspection/printer depend on them).
- `attribute-helpers.ts` + the CST path (kept).
- Extracting a shared CST-read package (recorded as a follow-up; Mongo gets its own adapter copy).
- Descriptor-typed extension-block parameter resolution (the tracked project follow-up; only relevant if the policy-select printer test forces it — see halt-condition).

## Pre-investigated edge cases

| Edge case | Disposition | Notes |
| --------- | ----------- | ----- |
| `declarative-policy-select.round-trip.test.ts` needs descriptor-typed-block AST | Rework to hand-built `PslExtensionBlock` fixtures; HALT if it genuinely needs parse+resolve | The single biggest deletion blocker; descriptor-typed parsing has no symbol-table home. |
| Mongo combined-diagnostic surfacing | Mirror SQL's E1 combined-set + seed behaviour | Cross-target consistency — Mongo must not diverge from the SQL diagnostic contract. |
| `getPositionalArgument` legacy overload becomes dead after Mongo migrates | Leave `attribute-helpers.ts`; drop only the dead legacy-`PslAttribute` overload if cleanly separable | `parseQuotedStringLiteral` in the same file is shared and must stay. |
| Workspace-wide gate (not package-scoped) | The slice gate MUST be `pnpm test:packages` + `pnpm test:integration` + a repo-wide `rg parsePslDocument` | Directly prevents recurrence of the slice-2 escapee. |

## Slice-specific done conditions

- [ ] `rg 'parsePslDocument' packages/ test/ --glob '!**/*.md'` returns nothing (no production or test consumer; docs updated separately) — and `rg 'PslModel|PslField|PslCompositeType|PslNamedTypeDeclaration' packages/2-mongo-family/2-authoring/contract-psl/src` is empty.
- [ ] `parse.ts`/`symbol-table.ts`/`attribute-helpers.ts` (+ its test) remain; the printer `src/` + legacy `PslDocumentAst` types remain.
- [ ] Workspace-wide gate green: `pnpm test:packages` + `pnpm test:integration` (the slice deletes a public export, so the gate is repo-wide per the build-workflow cross-package-gate rule, not package-scoped).

## Open Questions

1. The `declarative-policy-select.round-trip.test.ts` rework (see edge case + halt-condition). Working position: hand-built `PslExtensionBlock` fixtures asserting print-only behaviour. If it genuinely needs the legacy parse+resolve, that's an operator decision (retire vs. relocate) surfaced at dispatch time.

## References

- Parent project: `projects/psl-cst-symbol-table/spec.md`
- Linear issue: [TML-2929](https://linear.app/prisma-company/issue/TML-2929)
- Slice 2 (the proven SQL pattern this mirrors): `projects/psl-cst-symbol-table/slices/migrate-sql-interpreter/`
- Mongo interpreter + provider + helpers: `packages/2-mongo-family/2-authoring/contract-psl/src/{interpreter,provider,psl-helpers}.ts`
- SQL adapters to trim-and-copy: `packages/2-sql/2-authoring/contract-psl/src/{cst-read,cst-read-views,symbol-views}.ts`
- Parser to delete: `packages/1-framework/2-authoring/psl-parser/src/parser.ts` + `src/exports/parser.ts` + `test/parser{,-enum}.test.ts`
- Kept shared helper: `packages/1-framework/2-authoring/psl-parser/src/attribute-helpers.ts`
- Printer tests to rework: `packages/1-framework/2-authoring/psl-printer/test/{print-psl-from-ast,declarative-policy-select.round-trip}.test.ts`
