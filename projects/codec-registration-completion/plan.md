# Plan — Codec registration completion (TML-2357)

> Milestones for the [spec](spec.md). Each milestone is one cohesive change that ends in a green-gates checkpoint and a pause-for-review with the user. If milestone diffs grow large enough, milestone boundaries become PR boundaries.

## Milestone summary

| # | Milestone | Spec ACs | Depends on |
|---|---|---|---|
| **M0** | Typed `Codec` flow through `CodecDescriptor` (precondition fix) — see [`specs/typed-codec-flow.spec.md`](specs/typed-codec-flow.spec.md) | AC-0 | none |
| **M1** | Narrow runtime `Codec` instance + migrate consumers + route emit through `descriptorFor.renderOutputType` (LANDED — see [code-review.md](reviews/code-review.md) M1) | AC-3 (m1 portion) | M0 (status: LANDED before M0 was diagnosed; revisit if M0's typed flow fix surfaces a regression here) |
| **M2** | Migrate every codec to native descriptor + delete synthesis bridge + delete `parameterizedCodecs:` slot + delete `CodecParamsDescriptor` + `aliasDescriptor` + delete `arktypeJsonEmitCodec` + retire legacy `mkCodec` / `defineCodecGroup` / `defineCodecBundle` public surface | AC-1, AC-2, AC-3 (m2 portion), AC-4 | M0, M1 |
| **M3** | `ParamRef.refs` plumbing + encode-side `forColumn` + retire `forCodecId` fallback for parameterized codec ids | AC-5 | M2 |
| **M4** | Delete `JsonSchemaValidatorRegistry` + retire `'json-validator'` trait | AC-6 | M2 |

`AC-7` (validation gates) is checked at the end of every milestone.

**Current branch state**: M1 is landed. M2 is partially landed (R1, R2, R3 on branch); R4 was rolled back at `fb1277438` per [`wip/unattended-decisions.md` Decision #11](../../wip/unattended-decisions.md). M0 lands first against current HEAD; M2 R4 retry follows once M0 unblocks the typed-instance deletion.

## Validation gates (every milestone)

All must be green before declaring a milestone done:

- `pnpm typecheck`
- `pnpm lint:deps`
- `pnpm test:packages`
- `pnpm test:e2e` (postgres real-DB)
- `pnpm build`
- `pnpm fixtures:check` (all fixture pairs byte-identical against `origin/main` baseline; supersedes the previous narrower `git diff -- examples/prisma-next-demo/contract.{json,d.ts}` gate per [Decision #8 in `wip/unattended-decisions.md`](../../wip/unattended-decisions.md))

## Milestone M0 — Typed `Codec` flow through `CodecDescriptor`

**Goal**: Fix `defineCodec`'s declared return so it preserves the codec generics (`Id`, `TTraits`, `TWire`, `TInput`) inferred from its `spec` argument. Restore the typed flow `defineCodec → descriptor record → defineContract → field.X() → sqlBuilder<typeof contract>` end-to-end. Emit-path `TypeMaps` derivation continues to work; demo emit byte-identical.

**Spec ACs addressed**: AC-0 (sub-spec [`specs/typed-codec-flow.spec.md`](specs/typed-codec-flow.spec.md)).

### Tasks

1. **T0.1 — Pick the implementation shape.** Two equivalent options:
   - **Shape A**: parameterize `CodecDescriptor` with `<Id, TTraits, TWire, TInput, TParams>`. `AnyCodecDescriptor = CodecDescriptor<string, readonly CodecTrait[], unknown, unknown, any>`.
   - **Shape B**: keep `CodecDescriptor<P>` one-arg; have `defineCodec` return `CodecDescriptor<TParams> & { codecId: Id; traits: TTraits; factory: typed-factory }` (intersection).

   Decide based on: (a) ergonomics at heterogeneous-storage sites (registration boundary), (b) clarity at consumer extraction sites (`PgDescriptors`, `SqlDescriptors`), (c) impact on `aliasDescriptor` composition (does it need to thread the same generics?). Both honour AC-0; pick the one with the lower diff cost.

2. **T0.2 — Update `defineCodec`'s signature** in `packages/2-sql/4-lanes/relational-core/src/ast/codec-types.ts:587-593` per the chosen shape. Internal helper `buildSqlCodec` (the codec-instance builder) keeps its current typed return; only the wrapping descriptor's exposed type changes.

3. **T0.3 — Update `CodecDescriptor` (Shape A only)** in `packages/1-framework/1-core/framework-components/src/shared/codec-types.ts`. Add the four extra type parameters with sensible defaults (`Id = string`, `TTraits = readonly CodecTrait[]`, `TWire = unknown`, `TInput = unknown`). Update `AnyCodecDescriptor` type alias.

4. **T0.4 — Update derivation helpers.** `DescriptorResolvedCodec` / `DescriptorCodecId` / `DescriptorCodecTraits` / `DescriptorCodecInput` / `ExtractDescriptorCodecTypes` (in `relational-core/ast/codec-types.ts`) extract directly from the descriptor type. No `D extends CodecDescriptor<infer P>` widening; either positional generic extraction (Shape A) or structural extraction (Shape B).

5. **T0.5 — Verify per-target descriptor records carry typed shape.** `PgDescriptors`, `SqliteDescriptors`, `PgvectorDescriptors`, `SqlDescriptors`, `ArktypeJsonDescriptors`. Each becomes `{[K]: defineCodec(...)-result}` typed by inference; no `: CodecDescriptor<...>` annotations widening the entries.

6. **T0.6 — Constructive type tests.** Negative type tests in:
   - `packages/2-sql/4-lanes/relational-core/test/typed-codec-flow.test-d.ts` — `defineCodec` round-trip extraction matches expected `Codec<...>`.
   - `packages/3-targets/3-targets/postgres/test/typed-descriptor-flow.test-d.ts` — `PgDescriptors['uuidv4']` extraction matches `Codec<'pg/uuid@1', ..., Buffer, string>`.
   - `examples/prisma-next-demo/test/no-emit-typed-flow.test-d.ts` (new file) — `field.uuidv4()` returns typed field spec; positive query expression typechecks; negative ones fail.

7. **T0.7 — Verify emit-path `TypeMaps` derivation.** Run `pnpm fixtures:check`; confirm zero drift across all fixture pairs. If drift surfaces, the emitter's descriptor-walk path is reading erased generics — fix at the emitter boundary.

8. **T0.8 — Opportunistic `byScalar` cleanup.** During the implementation, if `byScalar`'s presence in `packages/3-targets/3-targets/postgres/src/core/codecs.ts:518-526` (the `PgByScalar` `readonly codec: Codec` slot) creates impedance with the typed flow, delete or restructure it inline. Otherwise, leave it for the separate antipattern-cleanup ticket. Document any opportunistic cleanup in the M0 commit messages.

9. **T0.9 — Validation checkpoint** (gates above) and **pause for review**.

### Risks

- **Shape A's ergonomic cost.** 5-arg `CodecDescriptor` makes heterogeneous storage verbose. Mitigated by `AnyCodecDescriptor` alias — most code uses that. If verbosity bites at unexpected sites, fall back to Shape B mid-implementation.
- **`aliasDescriptor` composition.** Currently signed as `aliasDescriptor<P>(base: CodecDescriptor<P>, ...): CodecDescriptor<P>`. Under Shape A, generics need to thread through. Under Shape B, only the intersection structure changes. Walk the call sites in postgres/codecs.ts before committing to a shape.
- **Test fixture diff size.** Negative type tests are new files; existing test fixtures that read from descriptors may surface widening drift if the helpers extract differently. Acceptable; fix at the call sites.
- **TML-2229 regression vs. fix.** This was a regression in TML-2229 that should have been caught there. Landing M0 in TML-2357's branch is the pragmatic path; consider a follow-up ADR documenting the typed-flow design decision (which Shape was chosen and why), once the fix lands.

### Estimated diff

~5 production files (defineCodec signature + CodecDescriptor type + derivation helpers + per-target record annotations) + ~3 negative type test files + opportunistic `byScalar` cleanup if needed. No new packages.

## Milestone M1 — Narrow runtime `Codec` instance + emit through descriptor

**Goal**: The `Codec` interface in `framework-components` declares only `id` + the four conversion methods (`encode`, `decode`, `encodeJson`, `decodeJson`). Every consumer that read `traits` / `targetTypes` / `meta` / `renderOutputType` off a resolved codec migrates to read from `descriptorFor(codecId)`.

**Spec ACs addressed**: AC-3.

### Tasks

1. **T1.1 — Inventory consumer sites.** Run `grep -rn "codec\.\(traits\|targetTypes\|meta\|renderOutputType\)" packages --include="*.ts"` plus a TypeScript-level search for property accesses on `Codec` typed expressions. Record every production site (test sites can lag; they migrate too but don't block production-site migration). Cross-check against the spec's enumerated list.
2. **T1.2 — Narrow the base `Codec` interface** in `packages/1-framework/1-core/framework-components/src/shared/codec-types.ts`. Remove `traits`, `targetTypes`, `renderOutputType?`. Keep `id`, `encode`, `decode`, `encodeJson`, `decodeJson` — the async surface (Promise-returning encode/decode + `CodecCallContext`) is preserved per ADR 204 / ADR 207. Land alongside family-specific extension narrowing so the build doesn't break in two phases.
3. **T1.3 — Narrow family-specific `Codec` extensions.** SQL `Codec` in `packages/2-sql/4-lanes/relational-core/src/ast/codec-types.ts` loses `meta`-on-instance; `meta` consultation routes through descriptors. Mongo `MongoCodec` analogous narrowing — but only for the field set, no behavior change to Mongo dispatch (TML-2324's scope).
4. **T1.4 — Migrate emit-path `renderOutputType` consultation** to `descriptorFor(codecId).renderOutputType`. The only production read site on `origin/main` is `packages/1-framework/3-tooling/emitter/src/domain-type-generation.ts:259`; the audit grep should re-confirm but the prior task list's `emit.ts` / `emit-types.ts` / `generate-contract-dts.ts` enumeration was aspirational, not actual. After this, any `forCodecId(codecId).renderOutputType` lookup retires.
5. **T1.5 — Migrate other static-metadata read sites.** For each site found in T1.1:
   - `framework-components/control/control-stack.ts` — `codec.id` reads stay (id is on the instance); any `targetTypes` reads route through descriptors.
   - `contract-psl/provider.ts` — `descriptorFor(codecId).targetTypes[0]`.
   - `mongo-contract-psl/derive-json-schema.ts` — analogous.
   - `relational-core/ast/codec-types.ts` — `CodecRegistryImpl` (`register`, `hasTrait`, `traitsOf`) — these are part of the legacy `codecs:` slot path and may delete entirely in M2; for M1, keep them working by routing reads through descriptors-by-codec-id, with a TODO note pointing at M2.
   - `defineCodecs` builder — reads `codec.id` to populate `dataTypes`. Keep working; `id` stays on the instance.
   - `sql-runtime/codecs/decoding.ts` — `codec.id` reads stay; if any read of `codec.traits` / `codec.targetTypes` exists, route through descriptor.
   - `postgres/3-targets/core/codecs.ts` — `aliasCodec` continues to work in M1 (still produces a `Codec`); the helper itself migrates to `aliasDescriptor` in M2.
   - `postgres/6-adapters/core/{adapter,descriptor-meta}.ts` — `Object.values(codecDefinitions)` mappings: read static metadata through descriptor map.
   - `mongo-codec/codec-registry.ts` — registry stays (Mongo registration migration is TML-2324); `codec.id` reads stay.
6. **T1.6 — Update `synthesizeNonParameterizedDescriptor`.** Today it reads `codec.traits` / `codec.targetTypes` / `codec.meta` from the codec instance. After M1 narrows the instance, the bridge takes those fields explicitly via an arg bag from the call site (`sql-context.ts`'s `registerInIndices(synthesizeNonParameterizedDescriptor(codec))` becomes `synthesizeNonParameterizedDescriptor(codec, { traits, targetTypes, meta })`, where the extra args come from the contributor's surrounding context). Decision: take the explicit-arg shape so contributor code keeps compiling; bridge dies in M2.
7. **T1.7 — Tests.** Update unit tests that constructed `Codec` instances with `traits` / `targetTypes` / `renderOutputType` to construct descriptors instead (or update test helpers that wrap the construction). Negative type tests in `framework-components/test/codec-types.types.test-d.ts` to assert the narrowed shape.
8. **T1.8 — Validation checkpoint** (gates above) and **pause for review**.

### Risks

- **Test fixtures.** Many tests construct codecs inline; the migration will surface in a wide test diff. Acceptable cost; tests follow production.
- **`renderOutputType` consultation surface.** The emitter has multiple call sites that consult the renderer; each must route through the descriptor map. If any call site doesn't have descriptor-map access today, lift it through the call signature instead of reaching for a cast.
- **Cast surfacing.** Removing fields may force a few sites that were reading them to introduce casts if the descriptor isn't available. Each such site is a real bug — the descriptor IS available at every legitimate read site. Lift the descriptor reference into the call site instead of casting.

### Estimated diff

~15–20 production files touched + ~10 test files. No new packages.

## Milestone M2 — Native descriptor migration + bridge deletion + `aliasDescriptor` + emit-shim deletion

**Goal**: Every codec contributor ships native `CodecDescriptor`s. The synthesis bridge, `parameterizedCodecs:` slot, `CodecParamsDescriptor`, `aliasCodec` helper, and `arktypeJsonEmitCodec` all delete. Contributors expose a single `codecs: () => ReadonlyArray<CodecDescriptor>` slot.

**Spec ACs addressed**: AC-1, AC-2, AC-4.

### Tasks

1. **T2.1 — Introduce `aliasDescriptor`** in `packages/3-targets/3-targets/postgres/src/core/codecs.ts` (or in framework-components if shared). Signature: `aliasDescriptor<P>(base: CodecDescriptor<P>, overrides: { codecId, targetTypes, meta? }): CodecDescriptor<P>`. The alias's `factory` delegates to `base.factory` and rewrites `id` on the resolved codec.
2. **T2.2 — Migrate sql-relational-core base codecs to descriptors.** ~6 codecs (char, varchar, int, float, text, timestamp). Each gains a sibling `*Descriptor` export. `defineCodecs` builder may need a parallel `defineCodecDescriptors` shape, or absorb descriptors directly. Decision deferred to implementation start: prefer absorbing into `defineCodecs` if structurally clean.
3. **T2.3 — Migrate postgres target codecs to descriptors.** ~22 codecs across `packages/3-targets/3-targets/postgres/src/core/codecs.ts`. Each `pg*Codec` becomes a `pg*Descriptor`; `aliasCodec` calls become `aliasDescriptor`. The target/adapter's `codecs:` contributor slot returns the descriptor list. The `parameterizedCodecs:` slots (currently `[]` everywhere except the postgres/sqlite adapters and pgvector/arktype-json runtime descriptors) all delete.
4. **T2.4 — Migrate sqlite target codecs to descriptors.** ~7 codecs (text, integer, real, blob, boolean, datetime, json, bigint). Same pattern as postgres.
5. **T2.5 — Migrate pgvector to descriptor-only.** `pgVectorCodec` is already a descriptor. Move it through the unified `codecs:` slot; the parent project already deleted `pgVectorRepresentativeCodec`.
6. **T2.6 — Migrate arktype-json to descriptor-only.** `arktypeJsonCodec` already a descriptor; move it from `parameterizedCodecs:` to `codecs:`. Delete `arktypeJsonEmitCodec` from `arktype-json-codec.ts:341` and from `pack-meta.ts:38`'s `codecInstances: [arktypeJsonEmitCodec]`. Emit consults `descriptorFor('arktype/json@1').renderOutputType` per M1's T1.4. (The `JsonSchemaValidatorRegistry` consumption stays until M4; arktype-json already validates inline so this isn't a regression.)
7. **T2.7 — Delete `synthesizeNonParameterizedDescriptor`** from `framework-components/src/shared/codec-types.ts` and its export. Update any test that imported it (`sql-orm-client/test/model-accessor.test.ts` is a known site) to construct descriptors directly.
8. **T2.8 — Delete `parameterizedCodecs:` slot.** Remove from `SqlStaticContributions`, `Adapter`, `RuntimeAdapter`, `RuntimeTarget`, `ControlAdapter`, every contributor's runtime/control descriptor, and `cli/src/control-api/contract-enrichment.ts`'s destructure (currently `parameterizedCodecs: _pc`).
9. **T2.9 — Delete `CodecParamsDescriptor`** from `packages/2-sql/4-lanes/relational-core/src/ast/codec-types.ts`. The adapter-level `parameterizedCodecs():` collapses into the unified `codecs():` slot; runtime materialization continues through the unified `CodecDescriptor<P>` map.
10. **T2.10 — Tests.** Per-package codec descriptor tests already cover the new shape (parent project added them); update test fixtures that constructed codecs through the legacy slot. Add an explicit test that the synthesis bridge can no longer be reached (constructive check on the descriptor map population).
11. **T2.11 — Validation checkpoint** and **pause for review**.

### Risks

- **`defineCodecs` reshape.** The builder currently keys off `codec.id` and `codec.targetTypes` to construct `dataTypes` and `CodecTypes`. After narrowing, those reads route through descriptors. The builder may need to take descriptors directly. This may surface a real type-design choice; resolve at implementation time.
- **Contributor protocol breakage.** Removing `parameterizedCodecs:` from `SqlStaticContributions` is a typed-protocol change; every implementor must update. Mongo's analogous slot stays for now (out of scope per non-goals).
- **Adapter-level `CodecParamsDescriptor` migration.** The postgres and sqlite adapters consume `CodecParamsDescriptor` shape internally for parameterized codec metadata. Migrating to consume `CodecDescriptor` directly may require lifting the read sites. Audit at implementation start.

### Estimated diff

~30 production files touched (per-codec migrations + slot deletions + cli enrichment + adapter reshape) + ~20 test files. The single biggest milestone by diff size.

## Milestone M3 — `ParamRef.refs` plumbing + encode-side `forColumn` + `forCodecId` retirement

**Goal**: Every `ParamRef` constructed at a column-bound site carries `refs: { table, column }`. A builder-pipeline validator pass enforces refs-required for parameterized codec ids. Encode-side dispatch goes through `forColumn(refs.table, refs.column)`. The `forCodecId` fallback retires for parameterized codec ids.

**Spec ACs addressed**: AC-5.

### Tasks

1. **T3.1 — Audit refs-less encode-side call sites.** Grep for every `ParamRef.of(...)` and `new ParamRef(...)` in production. For each, determine: is the call site column-bound (refs available)? If yes → must populate refs in T3.4. If no → does it ever target a parameterized codec id today? If yes → bug; either populate refs (best) or document the constraint. If no → fine; the new validator-pass invariant won't fire here. Production sites identified on `origin/main` (verify before implementation):
   - `packages/2-sql/4-lanes/relational-core/src/expression.ts:75`
   - `packages/2-sql/4-lanes/sql-builder/src/runtime/mutation-impl.ts:43,47`
   - `packages/3-extensions/sql-orm-client/src/query-plan-mutations.ts:50,96`
   - `packages/3-extensions/sql-orm-client/src/where-binding.ts:125`
   - `packages/3-extensions/sql-orm-client/src/types.ts:293`
2. **T3.2 — Extend `ParamRef` AST node.** Add `refs?: { table: string; column: string }` to `ParamRef` in `packages/2-sql/4-lanes/relational-core/src/ast/types.ts`. Update the constructor and `ParamRef.of` factory to accept refs in their options bag. Verify `Expression.fold` / `rewrite` / `accept` thread refs through any rewriter that constructs new `ParamRef` instances.
3. **T3.3 — Add a builder-pipeline validator pass.** A new `validateParamRefRefs(plan, descriptorMap)` pass that walks the plan's expression tree, identifies every `ParamRef` whose `codecId` is parameterized (i.e. `descriptorFor(codecId).paramsSchema` validates a non-`void` shape), and asserts `refs !== undefined`. Refs-less parameterized-codec-id `ParamRef`s throw a clear diagnostic naming the codec id and the binding site.
   - **Decision**: validator pass (option b from the design discussion), not constructor-time enforcement (option a). Keeps AST construction context-free; the builder pipeline already runs typed validation passes and this fits naturally. Document the call site that runs the pass.
4. **T3.4 — Populate refs at every column-bound site.** For each site in T3.1 that has the column ref available at construction time, thread it through.
5. **T3.5 — Encode-side dispatch via `forColumn`.** `encodeParam` in `packages/2-sql/5-runtime/src/codecs/encoding.ts` consults `paramRef.refs` and resolves through `contractCodecs.forColumn(refs.table, refs.column)` when present. Falls back to `descriptorFor(codecId).factory(undefined)(syntheticInstanceCtx)` for non-parameterized codec ids without refs. The `forCodecId` path retires for parameterized codec ids (the validator-pass invariant guarantees we never hit it for them).
6. **T3.6 — Tests.**
   - Validator pass: a unit test that constructs a `ParamRef` for `pg/vector@1` without refs and asserts the validator throws.
   - Encode-side dispatch: an integration test that sends a vector value through the SQL builder and asserts encode goes through `forColumn`, not `forCodecId`.
   - Refs propagation: tests for each migrated builder/orm site that the constructed `ParamRef` carries refs.
7. **T3.7 — Validation checkpoint** and **pause for review**.

### Risks

- **Refs propagation surface area.** The 5 enumerated sites in T3.1 may not be exhaustive; the audit must surface any others. The grep is the surface-area check.
- **Validator-pass ergonomics.** Refs-less parameterized-codec-id `ParamRef`s exist transiently in the AST. The validator must run before encode. Document this clearly; add a CI-style assertion in builder-pipeline tests.
- **Refs and rewriters.** AST rewriters (`Expression.rewrite`) construct new `ParamRef` instances; need to preserve refs across rewrites. Verify by exhaustive search of `new ParamRef(...)` and `ParamRef.of(...)` inside rewriter implementations.

### Estimated diff

~10 production files (AST + 5 binding sites + validator + encode site) + ~5 test files. Smaller than M2 but more cross-cutting.

## Milestone M4 — `JsonSchemaValidatorRegistry` deletion + trait retirement

**Goal**: JSON-Schema validation lives in the resolved codec's `decode` body (already the case for `arktypeJsonCodec` per parent's Phase C). The `JsonSchemaValidatorRegistry`, `buildJsonSchemaValidatorRegistry`, the `jsonSchemaValidators?` slot on `ExecutionContext`, and `packages/2-sql/5-runtime/src/codecs/json-schema-validation.ts` all delete. The `'json-validator'` `CodecTrait` retires if no consumer remains.

**Spec ACs addressed**: AC-6.

### Tasks

1. **T4.1 — Audit `'json-validator'` trait consumers.** Grep `'json-validator'` and `extractValidator` (or analogous helpers). Record every read; verify each can either route through inline validation or delete entirely.
2. **T4.2 — Verify arktype-json's inline validation path is the only producer of validator state.** Parent's Phase C ships this; confirm no other production codec writes to `JsonSchemaValidatorRegistry` today.
3. **T4.3 — Delete `JsonSchemaValidatorRegistry`** from `packages/2-sql/4-lanes/relational-core/src/query-lane-context.ts`. Delete `buildJsonSchemaValidatorRegistry` from wherever it lives (probably `sql-runtime`).
4. **T4.4 — Delete the `jsonSchemaValidators?` slot** on `ExecutionContext`. Update every site that constructed or threaded the slot.
5. **T4.5 — Delete `packages/2-sql/5-runtime/src/codecs/json-schema-validation.ts`** and any callers of its exports.
6. **T4.6 — Retire the `'json-validator'` `CodecTrait`.** If T4.1 found no consumers, delete from `framework-components/src/shared/codec-types.ts`. If a consumer remains as a structural marker, update the trait's docstring to reflect the inline-validation reality and keep it; delete in a follow-up ticket.
7. **T4.7 — Tests.**
   - Replace or update `packages/2-sql/5-runtime/test/json-schema-validation.test.ts` — its tests will need to assert against the inline-validator path. Most likely the file deletes; arktype-json's own tests already cover the inline path.
   - Real-DB e2e: arktype-json roundtrip (encode + decode + validation rejection on malformed payload).
8. **T4.8 — Validation checkpoint** and **pause for review**.

### Risks

- **Hidden consumers of the validator registry.** The grep audit is the safety net; if a non-arktype-json consumer surfaces, evaluate whether to migrate it inline or retain the registry as a structural marker. Likely outcome: no other consumers (the registry was built for the `pg/json@1` schema-typed factory, which deleted in parent's Phase C).
- **Decode-error diagnostic regression.** The validator registry's diagnostics may be richer than the inline path; verify the inline error envelope (`RUNTIME.JSON_SCHEMA_VALIDATION_FAILED` per parent's verification) carries equivalent information (column name, expected schema, actual value).

### Estimated diff

~5 production files (registry deletion + slot deletion + json-schema-validation.ts deletion) + ~5 test files (mostly the validator-registry test deleting).

## Project-wide close-out

Done after M4 lands cleanly. Per the [drive-project-workflow](../../.cursor/rules/drive-project-workflow.mdc) close-out steps:

1. **Migrate long-lived docs into `docs/`.** ADR 208 was authored by the parent project to describe the unified model; verify it accurately reflects the post-TML-2357 state (no synthesis bridge mentioned, no `forCodecId` fallback for parameterized codec ids, no emit-shim, no `CodecParamsDescriptor`, runtime `Codec` shape narrow). If updates are needed, land them as part of M4 or a follow-up close-out commit.
2. **Strip repo-wide references to `projects/codec-registration-completion/**`** (replace with ADR 208 links or remove).
3. **Delete `projects/codec-registration-completion/`** in the close-out commit.
4. **Linear**: TML-2357 auto-closes when the PR(s) merge (issue id in branch name + PR title).

## Open items (deferred)

- **`pgEnumCodec` factory audit** — its factory is a placeholder; documented in ADR 208 § Future work; separate ticket.
- **Mongo registration migration + Mongo runtime `forColumn`** — TML-2324.
- **Mongo control-plane `parameterizedCodecs:` slot** — separate ticket; Mongo demos don't use parameterized codecs, so the gap is authoring-time only.
- **Future per-library JSON extensions (zod, valibot)** — not blocked by this work.
