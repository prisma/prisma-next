# M5a — PSL Consumer Cascade Audit (Round 2)

> Pre-flight reconnaissance for Reading D (FR16a): collapsing the flat-model
> `PslDocumentAst` (`models`, `enums`, `compositeTypes`, `types`) into a single
> `namespaces` container. The goal is to confirm which consumers absorb the
> shape change trivially and which need to be taught namespace-awareness
> before we commit to lowering the AST.

## Method

`PslDocumentAst` enumeration starts from the type declaration in
[`packages/1-framework/1-core/framework-components/src/control/psl-ast.ts (L174–L182)`](../../packages/1-framework/1-core/framework-components/src/control/psl-ast.ts:174-182).
Consumers were inventoried via two ripgrep sweeps:

1. `rg 'PslDocumentAst|PslModel\b|PslEnum\b|PslCompositeType\b|PslTypesBlock\b' packages/ test/`
2. `rg 'document\.ast\.|\.ast\.models|\.ast\.enums|\.ast\.compositeTypes|\.ast\.types' packages/ test/ examples/`

Every hit that walked or constructed the document-level shape (as opposed to
threading the AST type through as an opaque value) is in the table below.
Consumers that only see `PslModel` / `PslEnum` etc. *after* the document has
already been unpacked are noted as **insulated** rather than itemised.

## Audit table

Estimated LOC counts the lines that have to change inside the file, not the
overall file size.

| # | Consumer path | Reads which AST slots today | Reading-D impact | Required change | Est. LOC |
|---|---|---|---|---|---|
| 1 | [`packages/1-framework/2-authoring/psl-parser/src/parser.ts`](../../packages/1-framework/2-authoring/psl-parser/src/parser.ts) (L60–L222) | **Producer.** Emits `PslDocumentAst` with `models`, `enums`, `compositeTypes`, optional `types`. | Major. Has to recognise the new top-level `namespace { … }` block, accumulate model/enum/composite-type/types blocks into a per-namespace bucket, route bare top-level blocks into a default `__unspecified__` bucket (FR16d), and emit `namespaces` as the sole models container. Cross-bucket validations (named-type ↔ model/enum/composite-type collisions on L144–L173) need to become per-namespace, with cross-namespace collisions handled per the spec. | Add `parseNamespaceBlock`, refactor top-level dispatch loop to fill `Map<string, NamespaceAccumulator>` keyed by namespace id (`__unspecified__` default), then emit a single `namespaces` array. Move collision checks behind a per-namespace pass. | 80–120 |
| 2 | [`packages/1-framework/2-authoring/psl-printer/src/ast-to-print-document.ts`](../../packages/1-framework/2-authoring/psl-printer/src/ast-to-print-document.ts) (L23–L46) | `ast.models`, `ast.enums`, `ast.types`, plus an FK topo-sort on `ast.models` (L212–L293). `ast.compositeTypes` not currently printed. | Medium. The FK topo-sort and dedup are global today; under Reading D they have to flatten across namespaces while preserving namespace ownership for emit. The `PrintDocument` shape itself currently has no namespace concept and must grow one (or be emitted bucket-by-bucket). | Iterate namespaces, collect models with namespace tags, flatten for topo-sort, then re-bucket for output. Either add a `namespaces` array to `PrintDocument` (preferred) or render `namespace { … }` blocks from the printer side. | 40–80 |
| 3 | [`packages/1-framework/2-authoring/psl-printer/test/print-psl-from-ast.test.ts`](../../packages/1-framework/2-authoring/psl-printer/test/print-psl-from-ast.test.ts) | Read-side: `parsed.ast.models`, `.ast.enums` to assert round-trips. | Trivial (test-side). Either drop helper hits through `flatModels(ast)` or migrate the assertions to navigate `ast.namespaces[*].models`. Reduces to a handful of mechanical edits once a helper exists. | Add a flatten helper, update ~5 assertion sites. | 10–15 |
| 4 | [`packages/2-sql/2-authoring/contract-psl/src/interpreter.ts`](../../packages/2-sql/2-authoring/contract-psl/src/interpreter.ts) (L1300–L1336 and downstream) | `input.document.ast.{models,enums,compositeTypes,types}` flattened into local arrays, then walked for model lowering, enum lowering, named-type resolution, FK metadata, backrelation candidates. | Major (this is the load-bearing one). Has to iterate namespaces, lower each block under its namespace identity, key produced storage objects by namespace id, and route cross-namespace FK references via dot-qualified type names through `psl-field-resolution` (FL-02). Many internal helpers thread `modelNames`/`compositeTypeNames` as flat sets; those need either to become namespace-qualified or to be split into per-namespace passes. | Replace the flat `models = … ?? []` block with a namespace walk; thread `namespaceId` (or the full `Namespace`) into `processEnumDeclarations`, `resolveNamedTypeDeclarations`, `buildModelMappings`, FK resolution. Add namespace-qualified-name resolution. | 150–250 |
| 5 | [`packages/2-mongo-family/2-authoring/contract-psl/src/interpreter.ts`](../../packages/2-mongo-family/2-authoring/contract-psl/src/interpreter.ts) (L97, L198, L261, L800–L920) | `document.ast.models`, `document.ast.compositeTypes` — multiple separate passes (polymorphism collection, model interpretation, composite-type interpretation). | Major within the Mongo interpreter but Mongo doesn't yet expose multi-database namespacing; the simplest valid lowering is "all blocks land in the single `__unspecified__` Mongo database namespace." Still has to walk `namespaces[*]` rather than `models`/`compositeTypes` directly. Cross-namespace references in Mongo are out of scope for M5a per the plan. | Replace the four `document.ast.{models,compositeTypes}` hits with iteration over `namespaces[*]`, asserting at most one namespace until Mongo grows multi-database support. | 30–50 |
| 6 | [`packages/2-sql/9-family/src/core/psl-contract-infer/sql-schema-ir-to-psl-ast.ts`](../../packages/2-sql/9-family/src/core/psl-contract-infer/sql-schema-ir-to-psl-ast.ts) (L119–L167) | **Producer.** Constructs `PslDocumentAst` with `models`, `enums`, `compositeTypes: []`, optional `types`. | Medium. `SqlSchemaIR.tables` is already namespace-aware (one storage per namespace) — the synthesizer just needs to group its emitted `PslModel[]` by source namespace and emit a `namespaces[*]` array. Named types and enums likewise need to be routed to the right namespace. | Pass the storage's namespace id through `buildModel`, group results into a `Map<string, NamespaceContents>`, emit a single `namespaces` field instead of flat `models/enums/types`. | 60–100 |
| 7 | [`packages/2-sql/2-authoring/contract-psl/test/interpreter.diagnostics.test.ts`](../../packages/2-sql/2-authoring/contract-psl/test/interpreter.diagnostics.test.ts) (L69–L99 — one hand-rolled `PslDocumentAst`) | Constructs `{kind: 'document', models: [], enums: [], compositeTypes: [], types: {…}}` literally. | Trivial. Single fixture; rewrite to `{kind: 'document', namespaces: [{id: '__unspecified__', models: [], enums: [], compositeTypes: [], types: {…}}]}` (or whatever default-namespace identifier the lowering picks). | Update one literal. | 5–10 |
| 8 | [`packages/1-framework/3-tooling/cli/test/commands/inspect-live-schema.test.ts`](../../packages/1-framework/3-tooling/cli/test/commands/inspect-live-schema.test.ts) (L288) and [`packages/1-framework/3-tooling/cli/test/control-api/client.test.ts`](../../packages/1-framework/3-tooling/cli/test/control-api/client.test.ts) (L903) | Stub `{kind: 'document', models: []} as unknown` to feed `inferPslContract` plumbing. | Trivial. Cast already escapes the type system; only the stub's literal shape needs to match what runtime code dereferences (which is nothing — `inferPslContract` is treated as a passthrough). | Either widen the stub to include `namespaces: []` or leave the cast in place and update once at the time we strengthen the runtime assertions. | 2–4 |
| 9 | [`packages/1-framework/3-tooling/cli/test/commands/contract-infer.command.test.ts`](../../packages/1-framework/3-tooling/cli/test/commands/contract-infer.command.test.ts) (L13–L25) | Constructs a synthetic `PslDocumentAst` (flat slots) and pipes through `printPsl`. | Trivial. Same as the diagnostics fixture — one literal, mechanical move into a single namespace. | Update one literal. | 5–10 |
| 10 | [`packages/1-framework/1-core/framework-components/test/control-capabilities.test.ts`](../../packages/1-framework/1-core/framework-components/test/control-capabilities.test.ts) (L10–L20) | Defines `SYNTHETIC_AST` with flat slots, returned by a fake `inferPslContract`. | Trivial. Update the synthetic literal. | One literal. | 3–5 |
| 11 | [`packages/1-framework/2-authoring/psl-parser/test/parser.test.ts`](../../packages/1-framework/2-authoring/psl-parser/test/parser.test.ts) (~25+ hits on `result.ast.models|enums|compositeTypes|types`) | Asserts on `ast.models[*]`, `ast.enums[*]`, `ast.compositeTypes[*]`, `ast.types.declarations[*]` across many tests. | Trivial individually, voluminous collectively. None of the test cases use a `namespace { … }` block, so every existing assertion should run against the default `__unspecified__` namespace. A `flatModels(ast)` / `firstNamespace(ast)` helper collapses the diff. | Add helpers, then mechanically rewrite the assertions. Worth doing in one pass to keep the parser test suite consistent. | 30–60 (mostly mechanical) |
| 12 | [`packages/2-sql/9-family/test/psl-contract-infer/sql-schema-ir-to-psl-ast.test.ts`](../../packages/2-sql/9-family/test/psl-contract-infer/sql-schema-ir-to-psl-ast.test.ts) | Asserts on the synthesizer's output (`ast.models`, etc.). | Trivial — synthesizer-mirroring. | Update assertions to walk `ast.namespaces[0]` (or use the same `flatModels` helper). | 15–30 |
| 13 | [`packages/2-sql/2-authoring/contract-psl/src/psl-field-resolution.ts`](../../packages/2-sql/2-authoring/contract-psl/src/psl-field-resolution.ts) | **Insulated.** Operates on `PslModel` (and `readonly PslModel[]` arrays at L421) passed in by the SQL interpreter, never on `PslDocumentAst`. | None at this layer. But the interpreter (row 4) has to pre-resolve dot-qualified type references *before* handing arrays here; that resolution is the FL-02 work, and the function signature may want to grow a "qualified type name → (namespace, model)" lookup. | Optional: extend the model-name resolution helpers to accept a `namespaceQualifier`. No mandatory edit. | 0–20 |
| 14 | [`packages/1-framework/1-core/framework-components/src/control/control-capabilities.ts`](../../packages/1-framework/1-core/framework-components/src/control/control-capabilities.ts), [`packages/1-framework/3-tooling/cli/src/control-api/types.ts`](../../packages/1-framework/3-tooling/cli/src/control-api/types.ts), [`packages/1-framework/3-tooling/cli/src/control-api/client.ts`](../../packages/1-framework/3-tooling/cli/src/control-api/client.ts), [`packages/1-framework/3-tooling/cli/src/commands/inspect-live-schema.ts`](../../packages/1-framework/3-tooling/cli/src/commands/inspect-live-schema.ts), [`packages/1-framework/3-tooling/cli/src/commands/contract-infer.ts`](../../packages/1-framework/3-tooling/cli/src/commands/contract-infer.ts), [`packages/2-sql/9-family/src/core/control-instance.ts`](../../packages/2-sql/9-family/src/core/control-instance.ts) | **Insulated.** All thread `PslDocumentAst` as an opaque value (capability typedef, control adapter return type, CLI passthrough into the printer). | None. They keep compiling against the new shape automatically because no slot is dereferenced. | None mandatory. | 0 |
| 15 | Mongo / extension contract fixtures (e.g. `packages/3-extensions/cipherstash/test/psl-interpretation.test.ts`, `packages/3-extensions/cipherstash/src/contract.prisma`) | **Insulated.** PSL text fixtures fed to the parser; consume the AST only via the parser/interpreter. | None unless the fixtures want to exercise namespace blocks (out of scope for M5a). | None mandatory; deferred to M5b for cross-namespace FK fixtures. | 0 |
| 16 | [`packages/1-framework/2-authoring/psl-parser/src/exports/index.ts`](../../packages/1-framework/2-authoring/psl-parser/src/exports/index.ts) | Re-exports the AST types. | Trivial — gains a `PslNamespace` export (or equivalent). | One barrel update. | 1–3 |

## Narrative

### (a) Consumers that absorb the change trivially

Everything that only threads `PslDocumentAst` through as an opaque value
(`inferPslContract`'s capability return type, the CLI's `inspectLiveSchema →
contract-infer` pipeline, the control adapter facades on both the framework
and SQL sides — rows 13 + 14) is insulated and needs no edits. The test
fixtures that build a `PslDocumentAst` literal (rows 7, 8, 9, 10) are
mechanical one-liner rewrites. `psl-field-resolution.ts` (row 13) operates
exclusively on `PslModel` arrays the interpreter hands it, so the document
shape never touches it — though it may *opt in* to a namespace-aware
qualified-name lookup once the M5b cross-namespace-FK work lands.

### (b) Consumers that need real teaching

Four files do most of the structural work:

1. **The framework PSL parser** (`parser.ts`, row 1). It has to recognise the
   new top-level `namespace { … }` block, accumulate per-namespace buckets,
   route bare top-level `model`/`enum`/`type`/`types` blocks into a default
   `__unspecified__` namespace (FR16d), and move its existing cross-kind
   collision checks behind a per-namespace pass.
2. **The SQL PSL interpreter** (`contract-psl/src/interpreter.ts`, row 4).
   The biggest single piece of work in the audit. The function-level shape
   stays — interpreter still produces `SqlContract` + diagnostics — but every
   internal helper that reads `models`/`enums`/`compositeTypes` needs to be
   threaded with namespace identity, and dot-qualified type references have to
   resolve via a namespace lookup rather than the current flat
   `Set<string>` membership check.
3. **The Mongo PSL interpreter** (row 5). Mongo doesn't grow real multi-namespace
   support in M5a, but the interpreter still has to walk `namespaces[*]`
   instead of `document.ast.models`; that's mostly a structural rewrite of
   four well-localised loops, plus a guard that at most one namespace is
   present until Mongo opts in to multi-database.
4. **The SQL printer + the inverse synthesizer** (rows 2 + 6). The printer
   adopts a `namespaces`-shaped `PrintDocument` (or emits `namespace { … }`
   blocks itself) and threads namespace ownership through its FK topo-sort.
   The synthesizer reads `SqlSchemaIR.tables` — which is *already*
   namespace-aware — and groups its emitted PSL nodes by source namespace.

### (c) Anything surprising

Two findings worth flagging:

1. **`PslDocumentAst.types` is a single optional block, not per-model
   metadata.** Reading D's `namespaces` shape needs to decide whether named
   types live at the document level (one global `types` block) or are
   per-namespace (each `namespace { … }` can carry its own `types { … }`
   block). The current parser path on L117–L121 only accepts one document-level
   `types` block, and the cross-kind collision check on L144–L173 enforces
   uniqueness across all models/enums/composite-types. The plan and spec
   should resolve this explicitly before we touch the parser — leaving named
   types document-scoped is the simpler answer and matches today's semantics;
   making them namespace-scoped is more symmetric but requires deeper edits
   in the interpreter's named-type resolution path.
2. **The Mongo PSL printer pipeline is missing.** I confirmed that only the
   *framework* `psl-printer` consumes `PslDocumentAst` today; there is no
   `mongo-family` printer mirror to update. That's a non-finding for M5a but
   worth recording: Mongo's PSL inspection path is currently parser-only, and
   the namespace lowering doesn't have to teach a Mongo printer anything.

There is no consumer whose flat-AST assumption is baked deep enough to
threaten Reading D's feasibility. The interpreter (row 4) is the largest
piece of work in absolute terms, but it sits on a clean function boundary
(`interpretPslDocumentToSqlContract`) and its internal helpers are already
parameterised on entity-context shape — so the cascade stays within the
file. No external consumer reaches into the interpreter's intermediate
`models`/`enums` arrays.

### (d) Per-family interpreter dispatch for `namespace { … }`

The `AuthoringEntityContext` SPI today exposes `{ family, target }`
([`framework-authoring.ts (L109–L112)`](../../packages/1-framework/1-core/framework-components/src/shared/framework-authoring.ts:109-112)).
Per-family dispatch — letting Postgres and Mongo each interpret a
`namespace { … }` block via their own contract-psl interpreter — is already
implementable on the existing surface: the entity-context lookup in both
interpreters already keys on `family`/`target` ids, and the framework parser
hands the same AST to whichever family the contract targets.

What does **not** exist on `AuthoringEntityContext` today is a way to thread
the *current namespace id* down into per-block factories (e.g. an enum
factory that wants to know which namespace it's declared in, so it emits the
right storage-key prefix or rejects cross-namespace constructs). Two options:

- **Thread `namespaceId` as a function parameter** through the interpreter's
  helpers (`processEnumDeclarations`, `resolveNamedTypeDeclarations`,
  `buildModelMappings`) without changing the SPI. This works if entity
  factories never need to read namespace identity themselves.
- **Add `namespace: NamespaceId` (or the full `Namespace` IR node) to
  `AuthoringEntityContext`** as a new optional field. Needed if any
  entity-type factory contributed by a pack needs namespace-awareness at
  factory-call time (e.g. an extension that wants to scope a contributed
  entity kind to a specific namespace).

R2 reconnaissance suggests the first option is sufficient for the M5a /
M5b scope as currently planned (no contributed entity kinds in M5a beyond
enum, which is namespace-agnostic from the factory's perspective). The
second option becomes interesting only if a downstream PR contributes an
entity kind whose factory needs namespace identity at construction time —
worth flagging in the M5a/M5b tasks but not blocking.

## Top-line findings (orchestrator summary)

- **No consumer threatens Reading D's feasibility.** The flat-AST surface is
  load-bearing in four files (parser, two interpreters, framework printer) plus
  one producer (`sqlSchemaIrToPslAst`); every other reference is either an
  opaque passthrough or a mechanical test-literal rewrite.
- **The SQL contract-psl interpreter is the largest single piece of work
  (~150–250 LOC).** Every internal helper that currently reads `models` /
  `enums` / `compositeTypes` arrays must thread namespace identity, and
  dot-qualified type references need namespace-aware resolution (the FL-02
  cross-namespace-FK work).
- **The framework parser change is non-trivial (~80–120 LOC).** It has to
  introduce the top-level `namespace { … }` keyword, default-bucket bare
  top-level blocks into `__unspecified__`, and move cross-kind collision
  checks behind a per-namespace pass.
- **The Mongo interpreter is mechanical (~30–50 LOC).** Four loops to rewrite;
  guard at most one namespace until Mongo grows multi-database support. No
  Mongo printer mirror exists, so the printer-side teaching is single-target.
- **The synthesizer (`sqlSchemaIrToPslAst`) gets cheaper than feared.**
  `SqlSchemaIR.tables` is already namespace-aware, so the lift is grouping
  emitted PSL nodes by source namespace (~60–100 LOC), not reshaping the IR.
- **Per-family dispatch is implementable without new SPI.** Existing
  entity-context lookups already key on `{family, target}`; `namespaceId` can
  thread through interpreter-local function arguments. Promoting
  `namespaceId` onto `AuthoringEntityContext` is *optional* and only becomes
  necessary if a contributed entity-type factory needs namespace identity at
  call time. Flag for M5b / follow-up — not a blocker for M5a.
- **One spec decision is still latent: per-namespace vs. document-level
  `types` block.** Today's parser accepts one document-level `types { … }`;
  Reading D needs an explicit answer (recommended: keep document-scoped) so
  the parser refactor has a settled target shape.
- **Test fixture migration is mechanical and voluminous (~50–100 LOC across
  ~6 files).** Worth a single mechanical pass (with a `flatModels(ast)` /
  `firstNamespace(ast)` helper) so the parser/interpreter test suites stay
  internally consistent.
- **Scope is consistent with the plan as written.** No surprise that pushes
  M5a beyond its current task budget; the named-types/namespace-scoping
  question is the only thing that should reach the spec before lowering work
  starts.
