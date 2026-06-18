## Dispatch plan

**Slice spec:** `projects/psl-cst-symbol-table/slices/migrate-mongo-and-remove-legacy-parser/spec.md`
**Linear:** TML-2929

**Validation gate — WORKSPACE-WIDE (not package-scoped).** This slice deletes a public export, so per the build-workflow cross-package-gate rule the gate is repo-wide: `pnpm typecheck` (workspace) + `pnpm test:packages` + `pnpm test:integration` + `pnpm lint:deps` + a repo-wide `rg 'parsePslDocument'` gate. Per-dispatch, scope the test command to the affected packages where a full run is wasteful, but the SLICE DoD requires the full workspace gate. (This directly prevents recurrence of the slice-2 escapee, where a package-scoped gate missed out-of-package consumers.)

Dispatches sequenced so deletion (D6) lands only after every consumer is migrated.

### Dispatch 1: sql-stragglers

- **Outcome:** The four out-of-package SQL consumers slice 2 left broken are rewired to `parse` + `buildSymbolTable` + the `{ symbolTable, sourceFile, sourceId }` input and pass: `test/integration/test/authoring/parity/ts-psl-parity.real-packs.test.ts`, `packages/3-extensions/postgres/test/psl-namespace-qualifier-routing.test.ts`, `test/integration/test/authoring/psl-index-type-options.integration.test.ts`, and the SQL half of `test/integration/test/value-objects/value-objects.integration.test.ts`.
- **Builds on:** Slice 2's shipped SQL symbol-table input + the `buildSymbolTableInput`-style helper pattern.
- **Hands to:** A repo with zero broken SQL consumers — `rg 'interpretPslDocumentToSqlContract\(\{ document'` empty. Independent of all Mongo work; runs first to clear the slice-2 escapee.
- **Focus:** The four test files only. No `src/` change. Mongo untouched.

### Dispatch 2: mongo-cst-adapters

- **Outcome:** The trimmed CST-read adapters exist package-local in `@prisma-next/mongo-contract-psl` (`cst-read` + view interfaces + `symbol-views`), covering `readFieldTypeAnnotation`, `readAttribute`, the `Range→PslSpan` maps, `buildModelView`/`buildCompositeTypeView`/`buildFieldView`, and `CstModelView`/`CstFieldView`/`CstCompositeTypeView`/`CstAttributeView` — but NOT `reconstructExtensionBlock`, `readConstructorCall`, `buildNamedTypeView` (Mongo has no enums/constructors/named-types). Unit-tested.
- **Builds on:** Slice 2's proven adapter shapes (trim-and-copy the SQL versions).
- **Hands to:** The CST-read surface the Mongo interpreter walk + helpers consume in dispatch 3.
- **Focus:** New Mongo-package adapter files + their tests. No interpreter wiring yet.

### Dispatch 3: mongo-interpreter-and-helpers

- **Outcome:** `interpretPslDocumentToMongoContract` input becomes `{ symbolTable, sourceFile, sourceId, scalarTypeDescriptors, codecLookup }`; the six `document.ast.*` walks (models, composite types, namespace-block rejection, the two polymorphism scans) retarget onto `SymbolTable.topLevel`; `psl-helpers.ts` retargets onto `CstAttributeView`. Legacy `Psl*`/`ParsePslDocumentResult` imports gone from Mongo `src/` except the provider (D4). Package typecheck green.
- **Builds on:** Dispatch 2's adapters.
- **Hands to:** A symbol-table-driven Mongo interpreter entry; only the Mongo provider still references the legacy parser.
- **Focus:** `interpreter.ts` + `psl-helpers.ts`. Diagnostic codes preserved (mirror SQL parity discipline).

### Dispatch 4: mongo-provider-and-tests

- **Outcome:** `provider.ts` calls `parse` + `buildSymbolTable({ …, scalarTypes: [...scalarTypeDescriptors.keys()] })` + combined-diagnostic seeding (mirroring SQL's E1 combined-set); the 7 Mongo test sites (2 unit helpers + 3 inline + the 3 Mongo-side integration/target consumers) fan out to the symbol-table input. Mongo `contract-psl` suite + the Mongo integration/target tests green; `rg 'parsePslDocument' packages/2-mongo-family` empty.
- **Builds on:** Dispatch 3's migrated interpreter entry.
- **Hands to:** A Mongo path fully off `parsePslDocument` — leaving the parser with zero interpreter consumers.
- **Focus:** Mongo `provider.ts` + the Mongo unit tests + the 3 Mongo-side integration/target consumers (`test/integration/test/mongo/migration-psl-authoring.test.ts`, `packages/3-mongo-target/1-mongo-target/test/mongo-runner.polymorphism.integration.test.ts`, the Mongo half of the value-objects integration test).

### Dispatch 5: printer-roundtrip-rework

- **Outcome:** The two printer round-trip test files no longer call `parsePslDocument`: `print-psl-from-ast.test.ts` round-trips convert to hand-built `PslDocumentAst` fixtures; `declarative-policy-select.round-trip.test.ts` reworked to hand-built `PslExtensionBlock` fixtures asserting print-only behaviour. Printer suite green. **Halt-condition:** if the policy-select test genuinely requires the legacy parse+resolve (not just print), STOP and surface (retire-vs-relocate is an operator decision).
- **Builds on:** Nothing in this slice (printer `src/` is untouched); independent — could run parallel to D1–D4, but sequenced here before the deletion.
- **Hands to:** A printer test suite with no `parsePslDocument` dependency — the last non-parser-package consumer cleared.
- **Focus:** The two printer test files only. Printer `src/` + legacy `PslDocumentAst` types untouched.

### Dispatch 6: delete-legacy-parser

- **Outcome:** `parsePslDocument` is gone: delete `src/parser.ts`, `src/exports/parser.ts`, the `parsePslDocument` export line in `src/exports/index.ts`, and `test/parser.test.ts` + `test/parser-enum.test.ts`; prune the now-legacy-only `ParsePslDocumentInput`/`ParsePslDocumentResult` re-exports. KEEP `attribute-helpers.ts` (+ its test), the CST path, the `PslDocumentAst`-family types. Update READMEs + ADR 163 reference. Repo-wide `rg 'parsePslDocument' --glob '!**/*.md'` empty.
- **Builds on:** Dispatches 1–5 (every consumer migrated) — the precondition for deletion.
- **Hands to:** Project DoD: one parser (`parse`) in the package; both interpreters + all consumers on the symbol table; printer/introspection green; legacy parser gone.
- **Focus:** Deletion + export prune + doc updates. The slice DoD's workspace-wide gate runs here in full.
