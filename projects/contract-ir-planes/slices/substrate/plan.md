# Slice Plan: substrate (S1.A)

**Slice spec:** [`./spec.md`](./spec.md)
**Parent plan:** [`projects/contract-ir-planes/plan.md`](../../plan.md) § S1.A
**Linear:** [TML-2584](https://linear.app/prisma-company/issue/TML-2584) (parent; no slice ticket per no-sub-issues rule)

## At a glance

Four dispatches, sequential. D1 lands the framework type primitives behind the rest of the project (no descriptor consumer yet). D2 extends the descriptor surface, wires generic dispatch through the family base, and registers the Postgres pack's enum kind through the descriptor. **D3 lands the vocabulary + walk cleanup** that emerged when the user surfaced the "slot key" redundancy and the "walk doesn't need up-front knowledge" insight at slice-PR open time — the structural property walk replaces the lookup table; the `storageSlotKey` descriptor field and its dependent infrastructure (parallel slot registry, `reservedStorageSlotKeys`, collision validator) come back out; the kind-keyed registry becomes the single source of truth. **D4 lands the artefact-review cleanup**: extends `EntityCoordinate` with a `plane: 'domain' | 'storage'` axis (A03; substrate, free now while there are no consumers), locks the slot-key naming convention to *essence + singular* (A08), and lands the planning-artefact text edits from the architect + principal-engineer reviews (A05 plane symmetric extensibility; A07 ADR Decision 5 rejected-alternative; F09 project plan Risk #5). Slice ships as one PR after D4.

D1 + D2 are **M**; D3 is **M** (~13 files; bounded mechanical cleanup of D2's surface); D4 is **S/M** (~5 files; substrate code for the plane axis + a test + four planning-artefact text edits). D1–D3 routed to **Opus**; D4 routes to **Composer-2.5** — bounded mechanical work with a fully-settled brief is exactly the substrate Composer-2.5 calibration recommends.

## Dispatch plan

### Dispatch 1: Framework type primitives

> **R2 redirect (2026-05-20):** R1 attempted to put `elementCoordinates()` on the `Storage` interface as a required method; structural assignability of emitted `contract.d.ts` literals against `Contract<SqlStorage>` consumers broke (the printed literal has no method members), surfacing as ~56 typecheck diagnostics across 29 fixtures and a `pnpm fixtures:check` byte-stability violation. R2 reframes the walk as a **free function** consuming any `Storage`-shaped value, dispatched on `Namespace.kind` via an inline lookup table. Interface stays unchanged; emitted literals keep satisfying every consumer; fixtures stay byte-stable. See dispatch brief for the revert-and-redo sequence.

**Intent.** Add the type substrate the rest of the project consumes. Three additive type changes + one narrowing + one free helper:

1. New `EntityCoordinate` type (`{ namespaceId, entityKind, entityName }`) co-located with `Storage` in `@prisma-next/framework-components/ir`.
2. Free `elementCoordinates(storage)` helper exported from the same module — yields `Generator<EntityCoordinate>` over any `Storage`-shaped value; internally consults an inline `Map<namespaceKind, slotKeys>` lookup table to know which slots to walk per `ns.kind`. Hardcoded for `'sql-namespace'` → `[tables, types]` and `'mongo-namespace'` → `[collections]`; D2 replaces the inline table with the pack-contributed descriptor registry. **The `Storage` interface is unchanged** — no method added.
3. Optional `domain` field added to the framework `Contract` type as `Record<string, Record<string, Record<string, unknown>>>`; canonicalizer's `TOP_LEVEL_ORDER` learns the new key.
4. `Namespace` interface narrowing: `kind` promoted from optional on `IRNode` to required on `Namespace`. The four concrete `NamespaceBase` subclasses change their `declare readonly kind?: string` to `declare readonly kind: string` (the runtime non-enumerable `Object.defineProperty` pattern stays intact). One downstream `?? 'mongo-namespace'` fallback in the mongo emitter is removed (F2 cure). `BuiltStorage<Definition>`'s two namespace-literal `kind?: string` declarations tighten to `kind: string`.

What stays the same: no on-disk contracts change. `storage.namespaces` shape unchanged. `models` / `valueObjects` / `roots` flat at root unchanged. `'postgres-enum'` literal sites unchanged. `extractStorageElementNames` migration-loader walker stays as-is (its replacement is S1.D's job). **The `Storage` interface itself is untouched** — no new method member.

**Files in play.**

- `packages/1-framework/1-core/framework-components/src/ir/storage.ts` — add `EntityCoordinate` type + inline `SLOT_KEYS_BY_NAMESPACE_KIND` table + free `elementCoordinates(storage)` function. **`Storage` interface unchanged.**
- `packages/1-framework/1-core/framework-components/src/exports/ir.ts` — wire the `EntityCoordinate` type re-export and the `elementCoordinates` value re-export
- `packages/1-framework/0-foundation/contract/src/contract-types.ts` — add `domain?` field to `Contract` interface
- `packages/1-framework/0-foundation/contract/src/canonicalization.ts` — extend `TOP_LEVEL_ORDER` (L17–L31) with `'domain'`; SQL-specific `storage.namespaces.*` path checks left untouched
- `packages/1-framework/1-core/framework-components/src/ir/namespace.ts` — narrow `Namespace.kind` to required; tighten `NamespaceBase` declaration
- `packages/2-sql/1-core/contract/src/ir/sql-storage.ts` — `SqlNamespacePayload.declare readonly kind?: string` → required (no method body added)
- `packages/2-sql/1-core/contract/src/ir/sql-unbound-namespace.ts` — `SqlUnboundNamespace.declare readonly kind?: string` → required
- `packages/2-mongo-family/1-foundation/mongo-contract/src/ir/mongo-storage.ts` — `MongoNamespacePayload.declare readonly kind?: string` → required (no method body added)
- `packages/2-mongo-family/1-foundation/mongo-contract/src/ir/mongo-unbound-namespace.ts` — `MongoUnboundNamespace.declare readonly kind?: string` → required
- `packages/2-sql/2-authoring/contract-ts/src/contract-types.ts` (lines 567, 574) — tighten `BuiltStorage<Definition>`'s two `readonly kind?: string` namespace-literal lines to `readonly kind: string`
- `packages/2-mongo-family/3-tooling/emitter/src/index.ts:56` — remove the `?? 'mongo-namespace'` fallback (F2 cure)
- `packages/1-framework/1-core/framework-components/src/ir/ir-node.ts` — **NO change** (kind stays optional on IRNode; only Namespace narrows)
- Audit-only (no edits expected): brand-check sites at `sql-storage.ts`, `sql-contract-serializer-base.ts` (`packages/2-sql/9-family/src/core/ir/`), `postgres-contract-serializer.ts` (`packages/3-targets/3-targets/postgres/src/core/`), `mongo-storage.ts`; defensive casts at `packages/2-sql/3-tooling/emitter/src/index.ts:421,429` and `packages/3-targets/3-targets/postgres/src/core/postgres-schema.ts:189`

**Done when.**

- [ ] `pnpm typecheck` clean — type-system-side narrowing fully propagated; any consumers that were reading `Namespace.kind` as optional are updated or proven unreachable
- [ ] `pnpm test:packages` green — runtime behaviour unchanged; the non-enumerable `kind` pattern still produces JSON without `kind` on namespace envelopes
- [ ] `pnpm lint:deps` clean — no new layering violations from the new exports
- [ ] `pnpm fixtures:check` clean — **byte-stability gate**; no fixture should change in this dispatch. Any drift signals the type-only change leaked into runtime behaviour and must be investigated, not committed
- [ ] Intent-validation: `git diff --stat` shows ≤ ~12 files in `packages/`; no edits to `'postgres-enum'` sites; no edits to `extractStorageElementNames`; no edits to `roots`
- [ ] Edge cases covered: `Namespace.kind` promotion (spec edge #1 — typecheck enforces), non-enumerable `Object.defineProperty` preservation (spec edge #2 — fixtures byte-stability), `instanceof NamespaceBase` brand-checks (spec edge #3 — typecheck + test:packages), `EntityCoordinate` field-order convention (spec edge #4 — type definition is the gate), `elementCoordinates()` iterator shape (spec edge #5 — type definition is the gate), `domain` plane unpopulated (spec edge #6 — typecheck + fixtures byte-stability)
- [ ] Grep gates per [`drive/calibration/grep-library.md`](../../../../drive/calibration/grep-library.md) § IR substrate hygiene: `rg 'namespaceId\?:' packages/` zero new occurrences; `rg '\.namespaceId\s*\?\?' packages/` zero new occurrences; F1 dual-shape-relocated grep zero hits

**Size.** M. ~10–12 files. Post-redirect the work is strictly mechanical: enumerated revert of R1's 8 unstaged files, then enumerated additive edits with verbatim type signatures + a pre-enumerated narrowing cascade (4 class declarations + 1 emitter fallback + 1 `BuiltStorage` type literal). The risk of type-system surprise in untouched packages is bounded by orchestrator-side grep enumeration (Step 9 of the brief) before `pnpm typecheck` is invoked.

**Model tier.** Composer-2.5 (slug: `composer-2.5-fast`). Per orchestrator routing rule (2026-05-20): aim for Composer-2.5 on implementation work when the dispatch is strictly bounded with no creative latitude. This dispatch qualifies — every file is enumerated, every edit is described literally, and hard escalation triggers (any of: cascade > 15 files, any fixture drift, any edit outside the enumerated files, any new `?? '…'` fallback against `ns.kind`, any modification of the `Storage` interface beyond co-locating `EntityCoordinate`) bound the dispatch. If any trigger fires, the orchestrator re-dispatches the residual on Opus 4.7 (`claude-opus-4-7-thinking-high`).

**DoR confirmed.**

- [x] Intent statement clear (3-bullet list above)
- [x] Files in play named (concrete paths)
- [x] "Done when" gates explicit (typecheck / test:packages / lint:deps / fixtures:check / grep gates / diff-stat sanity)
- [x] Predicted size M (re-decomposition trigger: if typecheck cascade exceeds 30 files modified, halt and re-plan into D1a/D1b/D1c per the spec's open-question split)
- [x] Failure modes from [`drive/calibration/failure-modes.md`](../../../../drive/calibration/failure-modes.md) considered: F1 (relocated dual shape — N/A this dispatch; no dual shape introduced), F2 (constructor magic for optional fields — relevant; the kind narrowing is the *cure* for F2 in the Namespace position, so the dispatch must not re-introduce `?? '…'` fallbacks), F4 (feature-sized dispatch without inspection — mitigated by ≤ 5 min WIP cadence)
- [x] Edge cases mapped to "Done when" gates
- [x] No silent design decisions: spec OQs 1, 4 settled at working positions; OQs 2, 3, 5 belong to D2

**Brief overlay** (when the implementer brief is assembled by `drive-build-workflow`):

- Brief MUST forbid destructive git operations per F5 (`git clean -f*`, `git reset --hard`, `git stash drop`, `git stash clear`, `git checkout -- .`, `rm -rf` against the worktree)
- Brief MUST name `pnpm fixtures:check` as a "no drift permitted" gate — this dispatch is type-additive, so any fixture drift is a bug
- Brief MUST instruct the implementer to use `rg` for cascade discovery before running `pnpm typecheck`, per F3 (discovery via test suite). The cascade from narrowing `kind` is bounded; the implementer should `rg 'namespace\.kind' packages/` and `rg 'kind\?:' packages/1-framework/1-core/framework-components/src/ir/namespace.ts` to enumerate sites before mass-editing.

---

### Dispatch 2: Descriptor mechanism + Postgres `postgresEnums` registration

**Intent.** Extend `AuthoringEntityTypeDescriptor` with three new fields (`storageSlotKey?`, `hydrate?`, `validatorSchema?`). Wire the SQL and Mongo family validators to compose contributed `validatorSchema` fragments at boot (as a no-op when nothing is contributed). Extend the SQL family base serializer to dispatch enum hydration through a registry keyed by `storageSlotKey` instead of by ad-hoc class-internal branching. Postgres pack registers `postgresEnums` via the new descriptor — the slot exists end-to-end but holds no entries until S1.B migrates them.

What stays the same: the hardcoded SQL validator `'types?': type({ '[string]': PostgresEnumTypeSchema })` entry stays (composition surface is **additive** — F1 risk pre-named). Enum entries continue to flow through the existing `storage.<ns>.types` slot. No on-disk contract changes. SQLite's `PostgresEnumStorageEntry` import sites stay untouched (Tier 3 deferred).

**Files in play.**

- `packages/1-framework/1-core/framework-components/src/shared/framework-authoring.ts` — extend `AuthoringEntityTypeDescriptor<Input, Output>` shape; preserve the contravariant `output.factory: (input: never, ctx) => unknown` inference contract
- `packages/2-sql/1-core/contract/src/validators.ts` — `NamespaceEntrySchema` (L168) learns to compose contributed `validatorSchema` fragments alongside the existing hardcoded `'types?'` slot
- `packages/2-mongo-family/1-foundation/mongo-contract/src/contract-schema.ts` — `MongoNamespaceEnvelopeSchema` (L320) gains the same composition surface; no-op for Mongo today (no pack contributions)
- `packages/2-sql/9-family/src/core/ir/sql-contract-serializer-base.ts` — extend the existing `entityTypeRegistry` (Map<kind, factory>) with a sibling registry for pack-contributed slot hydration, keyed by `storageSlotKey`. Working position per spec OQ2: parallel Map
- `packages/3-targets/3-targets/postgres/src/core/postgres-contract-serializer.ts` — refactor the existing enum branch in `hydrateSqlNamespaceEntry` to delegate to the registry (existing call path stays operational since the slot value reads still come from `storage.<ns>.types`)
- `packages/3-targets/3-targets/postgres/src/core/authoring.ts` — `postgresAuthoringEntityTypes.enum` descriptor populated with `storageSlotKey: 'postgresEnums'`, `hydrate: (raw) => new PostgresEnumType(raw)`, `validatorSchema: PostgresEnumTypeSchema` (re-exported from validators.ts for now; full extraction is S1.B's work)
- `packages/3-targets/3-targets/postgres/src/core/descriptor-meta.ts` — no change expected; descriptor registration flows through the existing `authoring.entityTypes` slot
- Validator added in scope: a new check that rejects pack-contributed `storageSlotKey` values matching the family's built-in slot names (`tables` for SQL, `collections` for Mongo) — catches authoring bugs at descriptor-registration time (spec edge #10)

**Done when.**

- [ ] `pnpm typecheck` clean — descriptor shape extension doesn't break the inference contract for existing pack contributions
- [ ] `pnpm test:packages` green — validator composition surface is genuinely no-op for non-contributing families
- [ ] `pnpm test:integration` green — end-to-end Postgres path still hydrates enums correctly (now via the registry; behaviour-identical to today)
- [ ] `pnpm lint:deps` clean — no new framework-imports-family violations from the descriptor surface
- [ ] `pnpm fixtures:check` clean — **byte-stability gate**; no fixture should change in this dispatch either
- [ ] Intent-validation: descriptor-extension fields are all optional (`?`); existing pack contributions compile without changes; framework-shared `storage.<ns>.types` slot still typed as today
- [ ] Edge cases covered: SQL validator hardcoded enum schema staying (spec edge #8 — code review verifies coexistence is additive, F1 grep gate clean), descriptor hydrate-delegated path (spec edge #9 — integration test confirms enum hydration goes through the registry), `storageSlotKey` collision with built-ins (spec edge #10 — unit test for the new validator)
- [ ] F1 dual-shape grep gate clean: `rg 'looksLikeFlat|normalizeStorageForHydration|stampNamespaceOnTable|normalizeStorageEnvelopeShape|isFlatTablesInput|isFlatTypesInput' packages/` zero hits
- [ ] Slice-spec OQ3 (`EntityKindDescriptor` extends vs parallel concept) resolved in code — descriptor shape extension chosen, not parallel concept introduced

**Size.** M. ~7 files, mostly mechanical type extension + one targeted refactor (Postgres serializer's enum branch → registry call). Lower cascade risk than D1.

**Model tier.** Opus (substrate change). Slug: `claude-opus-4-7-thinking-high`.

**DoR confirmed.**

- [x] Intent statement clear
- [x] Files in play named
- [x] "Done when" gates explicit
- [x] Predicted size M (re-decomposition trigger: if descriptor-registry shape requires a third Map keyed by something new, halt and resolve OQ2 in discussion mode rather than expanding scope inside the dispatch)
- [x] Failure modes considered: F1 (relocated dual shape — **directly relevant**; the hardcoded SQL validator enum schema must coexist additively, not be silently relocated into a new function), F4 (feature-sized — mitigated)
- [x] Edge cases mapped to "Done when" gates
- [x] No silent design decisions: spec OQs 2, 3, 5 working positions named (parallel registry Map; extend existing descriptor type; registration-order schema composition)

**Brief overlay:**

- Brief MUST forbid destructive git operations per F5
- Brief MUST name the F1 grep gate explicitly: "if you introduce a new function whose body looks like 'detect the legacy enum-in-types shape', stop and surface — that's F1 in this dispatch's territory"
- Brief MUST name the `storageSlotKey` collision validator as an in-scope deliverable, not an optional polish item

---

### Dispatch 3: Vocabulary cleanup + structural walk

> **Why this dispatch exists (slice-PR-open pushback, 2026-05-21).** When the slice PR (#552) opened, the user flagged two compounding design issues inherited from D1's framing and propagated by D2's brief: (a) the term "slot key" is a redundant name for what the codebase already calls *entity kind* / *discriminator* — the descriptor's `storageSlotKey` field and the `entityKind` field in the lookup table carried the same string in every entry; (b) the family-name-keyed lookup table inside `elementCoordinates(storage)` (`SLOT_KEYS_BY_NAMESPACE_KIND`) hardcoded `'sql-namespace'` and `'mongo-namespace'` into the framework layer (layering violation) and silently failed for Postgres contracts (whose hydrated namespace `kind` is `'schema'`, not `'sql-namespace'`). The orchestrator-side root cause is recorded in `drive/retro/findings.md` under the 2026-05-21 entry: D2's brief inherited `storageSlotKey?` as a "decided" field from the slice plan and forbade the implementer from re-questioning it, suppressing the question that would have caught the redundancy at brief-assembly time. D3 lands the corrections before the slice's PR merges so the substrate ships clean.

**Intent.** Replace `elementCoordinates`'s family-name-keyed lookup with a structural property walk over each namespace's own-enumerable entity-bearing properties. Drop the `storageSlotKey?` field from `AuthoringEntityTypeDescriptor`. Collapse the parallel `namespaceSlotHydrationRegistry` (added in D2) back into the existing `entityTypeRegistry` keyed by `discriminator` on both `SqlContractSerializerBase` and `MongoContractSerializerBase`. Drop `FamilyDescriptor.reservedStorageSlotKeys` (and its thread-through). Delete the `storageSlotKey`-collision validator and its unit test. Update Postgres pack to drop `storageSlotKey: 'types'`. Re-key validator-fragment composition on `discriminator`.

What stays the same: the descriptor's `hydrate?` and `validatorSchema?` fields stay (still valuable, still used). The validator-composition surface stays (still folds contributed fragments; just keyed on `discriminator` now). The Postgres pack's enum descriptor still ships `hydrate` + `validatorSchema`. The hardcoded SQL `'types?'` validator slot stays (F1 additive coexistence — S1.B's job to drop it). No on-disk contract changes.

**Files in play.** ~13 files.

- `packages/1-framework/1-core/framework-components/src/ir/storage.ts` — replace `SLOT_KEYS_BY_NAMESPACE_KIND` + lookup-driven walk with structural property iteration; update `Namespace` JSDoc with the invariant the walk relies on
- `packages/1-framework/1-core/framework-components/src/ir/namespace.ts` — JSDoc tightening for the structural-walk invariant
- `packages/1-framework/1-core/framework-components/src/shared/framework-authoring.ts` — drop `storageSlotKey?` from `AuthoringEntityTypeDescriptor`; update `hydrate?` / `validatorSchema?` JSDoc to name `discriminator` as the registry key
- `packages/1-framework/1-core/framework-components/src/shared/framework-components.ts` — drop `reservedStorageSlotKeys` export and `FamilyDescriptor.reservedStorageSlotKeys` field
- `packages/1-framework/1-core/framework-components/src/control/control-stack.ts` — drop `reservedStorageSlotKeys` thread-through
- `packages/1-framework/1-core/framework-components/test/control-stack.test.ts` — drop the `reservedStorageSlotKeys` test
- `packages/2-sql/9-family/src/core/control-descriptor.ts` — remove `reservedStorageSlotKeys: ['tables']`
- `packages/2-mongo-family/9-family/src/core/control-descriptor.ts` — remove `reservedStorageSlotKeys: ['collections']`
- `packages/2-sql/9-family/src/core/ir/sql-contract-serializer-base.ts` — remove `namespaceSlotHydrationRegistry` constructor parameter / field / `hydrateNamespaceSlot` helper; update `hydrateSqlNamespaceEntry` to walk the raw envelope's own-enumerable properties (tables → hardcoded `StorageTable`; other entity-bearing properties → `entityTypeRegistry.get(entry.kind)`)
- `packages/2-mongo-family/9-family/src/core/ir/mongo-contract-serializer-base.ts` — symmetric collapse
- `packages/3-targets/3-targets/postgres/src/core/postgres-contract-serializer.ts` — update enum-branch delegation to look up by entry `kind` through the family-base registry instead of by slot key
- `packages/3-targets/3-targets/postgres/src/core/authoring.ts` — drop `storageSlotKey: 'types'`
- `packages/2-sql/1-core/contract/src/validators.ts` — drop the slot-key collision validator added in D2 step 8; re-key `createSqlContractSchema` fragment composition on `discriminator`
- `packages/2-mongo-family/1-foundation/mongo-contract/src/contract-schema.ts` — symmetric re-key

**Done when.**

- [ ] `pnpm typecheck` clean — descriptor cleanup propagates; no `storageSlotKey` reference remains in `packages/`
- [ ] `pnpm test:packages` green — entry hydration round-trips byte-identically through the single `entityTypeRegistry`; validator-composition no-op preserved for Mongo
- [ ] `pnpm test:integration` green — **end-to-end Postgres path still hydrates enums correctly** through the registry; this is the load-bearing exemplar
- [ ] `pnpm lint:deps` clean — structural walk removes the framework→family lookup-table layering violation; lint:deps should remain clean (verify via dry-run)
- [ ] `pnpm fixtures:check` clean — **byte-stability gate holds**; no on-disk contract changes in this dispatch
- [ ] Intent-validation: `rg 'storageSlotKey' packages/` returns zero hits; `rg 'reservedStorageSlotKeys' packages/` returns zero hits; `rg 'namespaceSlotHydrationRegistry' packages/` returns zero hits; `rg 'SLOT_KEYS_BY_NAMESPACE_KIND' packages/` returns zero hits
- [ ] `Namespace` interface JSDoc declares the structural-walk invariant (every namespace concretion carries `id` + non-enumerable `kind` + entity-kind slot maps; no other own-enumerable data)
- [ ] Walks Postgres-promoted `PostgresSchema` namespace (whose `kind === 'schema'`) correctly — previously crashed under `SLOT_KEYS_BY_NAMESPACE_KIND.get('schema') === undefined`; now walks its own-enumerable `tables` / `types` properties structurally
- [ ] F1 dual-shape grep gate clean: `rg 'looksLikeFlat|normalizeStorageForHydration|stampNamespaceOnTable|normalizeStorageEnvelopeShape|isFlatTablesInput|isFlatTypesInput' packages/` returns zero hits

**Size.** M. ~13 files; pure mechanical retirement of D2's slot-key surface plus the walk rewrite. No new design judgment — the design is fully settled by spec § Approach D3.

**Model tier.** Opus (`claude-opus-4-7-thinking-high`). Substrate cleanup with TypeScript inference judgment on the collapsed registry shape + JSDoc invariant authoring. Composer-2.5 routed off because the per-property structural walk has a few edge cases (id skipping, kind auto-skipping by non-enumerability, defensive handling of pass-through `NamespaceBase` instances) where the implementer benefits from creative latitude on the helper boundary.

**DoR confirmed.**

- [x] Intent statement clear (vocabulary cleanup + structural walk; one paragraph above)
- [x] Files in play named (~13 concrete paths)
- [x] "Done when" gates explicit (typecheck / test:packages / test:integration / lint:deps / fixtures:check / grep gates / Postgres-promoted-namespace walk verification)
- [x] Predicted size M (re-decomposition trigger: if the registry collapse requires new design judgment beyond what's described in spec § Approach D3, halt; surface)
- [x] Failure modes considered: F1 (relocated dual shape — **directly relevant**; the validator composition stays additive, no replacement of the hardcoded path), F2 (constructor magic — N/A this dispatch; `kind`-required already in place from D1), F5 (destructive git — forbidden)
- [x] Edge cases mapped to "Done when" gates
- [x] No silent design decisions: spec OQ2 and OQ4 re-settled by D3; the spec's § Approach D3 enumerates every change

**Brief overlay:**

- Brief MUST forbid destructive git operations per F5
- Brief MUST name the F1 grep gate explicitly
- Brief MUST name the Postgres-promoted-namespace walk verification as a specific test (or assertion) — the previous lookup-table walk crashed for `kind === 'schema'`; the structural walk must succeed
- Brief MUST instruct the implementer to update the `Namespace` interface JSDoc with the structural-walk invariant before changing the walk body

---

### Dispatch 4: Coordinate plane axis + artefact-review cleanup

> **Why this dispatch exists (artefact-review pre-PR, 2026-05-21).** The architect + principal-engineer artefact reviews (under `projects/contract-ir-planes/reviews/artifacts-pre-d3/`) surfaced four substrate-altitude concerns the operator picked to settle now while there are no consumers to migrate: A03 (the coordinate is plane-blind; gain a `plane` axis), A05 (ADR Decision 1 frames asymmetric extensibility but both planes will be pack-extensible), A07 (ADR Decision 5 reads as if the descriptor surface was always-decided; the `storageSlotKey` excursion is invisible at ADR altitude), A08 (slot-key naming OQ1 — lock to *essence + singular* before S1.B ships the first pack contribution). F09 — the project plan's risk register is missing the "inherited decisions propagate without challenge" risk surface that produced D3's churn.
>
> The substrate rename (A01: existing `tables` → `table`, etc.) and the namespace-concretion `.entries` redirect (A02b) are explicitly **out of scope for D4** — they're ~150-call-site cascades + ~50–80 fixture regens; deferred to standalone Linear tickets (`relatedTo: ['TML-2584']`). D4 locks the new convention so future pack contributions don't grow the eventual rename cost.

**Intent.** Two code touches + four planning-artefact text edits:

1. **Code: `EntityCoordinate` gains a `plane: 'domain' | 'storage'` axis.** Type extended in `packages/1-framework/1-core/framework-components/src/ir/storage.ts`. `elementCoordinates(storage)` yields tuples with `plane: 'storage'` (the parameter type binds the plane; future `elementCoordinates(domain)` siblings yield `plane: 'domain'`). JSDoc on `EntityCoordinate` explains the axis and the domain → storage directional reference invariant the axis enables (encoded as a separate validator; not in coord shape).
2. **Code: a test** in `packages/1-framework/1-core/framework-components/test/` asserts the walk emits coordinates carrying `plane: 'storage'` for SQL, Mongo, and Postgres-promoted namespaces.
3. **Doc: ADR Decision 1 reframe (A05).** Already landed via orchestrator's pre-dispatch artefact edits (no implementer action — listed for completeness).
4. **Doc: ADR Decision 5 rejected-alternative + slot-key convention (A07 + A08).** Already landed via orchestrator's pre-dispatch artefact edits.
5. **Doc: project plan Risk #5 (F09).** Already landed via orchestrator's pre-dispatch artefact edits.
6. **Doc: project spec OQ1 lock + `postgresEnums` → `enum` propagation (A08).** Already landed via orchestrator's pre-dispatch artefact edits.

What stays the same: no on-disk contract changes; no descriptor surface changes; no namespace concretion class shape changes; no consumer call-site cascade (zero consumers of `EntityCoordinate` today per the PE pass's F02/PDoD6 verification).

**Files in play.** ~5 code + 1 test.

- `packages/1-framework/1-core/framework-components/src/ir/storage.ts` — extend `EntityCoordinate` with `plane: 'domain' | 'storage'`; populate `plane: 'storage'` in `elementCoordinates(storage)` yields; JSDoc the axis and the directional-reference invariant
- `packages/1-framework/1-core/framework-components/src/exports/ir.ts` — no API change (the type is re-exported by name; the axis addition is additive)
- `packages/1-framework/1-core/framework-components/test/element-coordinates.test.ts` (new or extend existing) — assert SQL/Mongo/Postgres walks all emit `plane: 'storage'`
- Adapter touchpoints: any internal cast / type assertion that consumed `EntityCoordinate` (likely none today; verify via `rg "EntityCoordinate" packages/`)

**Done when.**

- [ ] `pnpm typecheck` clean — type extension propagates; no consumer broken (verified: zero consumers pre-D4)
- [ ] `pnpm test:packages` green — new walk test passes; pre-existing element-coordinate tests still pass
- [ ] `pnpm lint:deps` clean — no layering shift
- [ ] `pnpm fixtures:check` clean — byte-stability gate holds (no on-disk shape change)
- [ ] Walk test asserts SQL, Mongo, **and** Postgres-promoted (`PostgresSchema`, `kind === 'schema'`) namespaces all yield coordinates with `plane: 'storage'` — three concretions in one test
- [ ] `rg "EntityCoordinate" packages/` enumerates every consumer; brief-author confirms zero or trivial-cast-update cascade before dispatch lands
- [ ] JSDoc on `EntityCoordinate` mentions: (a) `plane` axis values; (b) sibling `elementCoordinates(domain)` to come with S1.C; (c) domain → storage directional-reference invariant is a separate validator, not encoded in the coord

**Size.** S/M. ~5 files; substrate type extension + one test; planning-artefact text edits already landed pre-dispatch.

**Model tier.** Composer-2.5 (`composer-2.5-fast`). Bounded mechanical: type extension + test addition. No design judgment (design is fully settled by spec § Approach D4 + ADR Decision 3). Composer-2.5 is the right tier per [`drive/calibration/model-tier.md`](../../../../drive/calibration/model-tier.md) — small dispatches whose boundaries are strict.

**DoR confirmed.**

- [x] Intent statement clear (plane axis on coord + walk test; planning-artefact text edits pre-landed)
- [x] Files in play named (~5 concrete paths + test)
- [x] "Done when" gates explicit (typecheck / test:packages / lint:deps / fixtures:check / walk-test for three concretions / consumer enumeration)
- [x] Predicted size S/M (re-decomposition trigger: if `EntityCoordinate` consumer enumeration returns > 5 sites, halt; surface)
- [x] Failure modes considered: F2 (constructor magic — N/A this dispatch), F5 (destructive git — forbidden), F6 (inherited "decided" fields — N/A; design fully settled by the artefact reviews)
- [x] No silent design decisions: A03 axis shape settled at `{ plane, namespaceId, entityKind, entityName }`; A08 OQ1 settled at *essence + singular*; both recorded in ADR Decision 3 + Decision 5

**Brief overlay:**

- Brief MUST forbid destructive git operations per F5
- Brief MUST instruct the implementer NOT to rename existing slot names (`tables` etc.) — A01 is explicitly deferred to a standalone ticket
- Brief MUST instruct the implementer NOT to introduce a `.entries` redirect on namespace concretions — A02(b) is explicitly deferred to a standalone ticket
- Brief MUST cite the architect-review (A03) + PE-review (F02 cross-link on namespace concretions enumeration) findings for context
- Brief MUST require the walk test to cover SQL + Mongo + Postgres-promoted (`PostgresSchema`) concretions in one test, asserting `plane: 'storage'` for all

---

## Sanity checks

- [x] Each dispatch sized S/M (no L/XL); D1 has a re-decomposition trigger at >30 files cascaded; D3 has a "halt on new design judgment" trigger
- [x] Each "Done when" is binary + verifiable (specific commands; specific grep patterns; specific edge case references)
- [x] Every slice-spec edge case mapped to a covering dispatch:
  - Edges #1, #2, #3, #4, #5, #6, #11 (fixtures:check byte-stability) → D1
  - Edges #7 (Mongo no-op), #8, #9 → D2; collision-validator edge from prior draft → **removed in D3** along with the validator itself
  - New structural-walk-invariant edge (namespace concretions own-enumerable contents) → D3
  - New Postgres-promoted-namespace walk edge (the `kind === 'schema'` crash the lookup table caused) → D3 (fixed by structural iteration)
  - Edge #12 (`deserializeContract<T>` cast site) → **explicitly deferred per spec** (not in slice; revisited at S1.D)
  - Edges #13 (`'postgres-schema'` kind discriminator) — explicitly out per spec
  - Edges #14, #15, #16, #17 — explicitly out per spec
- [x] Slice-DoD's conditions are reachable from the dispatch sequence:
  - SDoD1 (CI gates) → both dispatches' validation gates
  - SDoD2 (edges) → mapped above
  - SDoD3 (reviewer accept) → PR-time review, not in-dispatch
  - SDoD4 (manual-QA N/A) → no dispatch needed
  - SDoD5 (no out-of-scope edits) → both dispatches' intent-validation
  - SDoD6 (grep gates) → both dispatches' grep-gate checklists

## Dispatch sequence (visualisation)

```text
D1 (Framework primitives) ──► commit ──► WIP inspection (≤ 5 min, orchestrator)
   │
   ├─ If typecheck cascade > 30 files: halt; re-plan as D1a/D1b/D1c
   └─ Else: proceed
   │
   ▼
D2 (Descriptor + Postgres registration) ──► commit ──► WIP inspection (≤ 5 min)
   │
   ├─ If `pnpm test:integration` regresses on Postgres enum: halt; debug
   │  before opening PR (enum hydration is the project's load-bearing exemplar)
   └─ Else: proceed
   │
   ▼
D3 (Vocabulary + structural walk cleanup) ──► commit ──► WIP inspection (≤ 5 min)
   │
   ├─ If grep gates fail (residual `storageSlotKey`, `reservedStorageSlotKeys`,
   │  `namespaceSlotHydrationRegistry`, `SLOT_KEYS_BY_NAMESPACE_KIND`): halt;
   │  finish the retirement before opening PR
   ├─ If Postgres-promoted-namespace walk test fails: halt; debug the
   │  structural iteration (the previous lookup table silently crashed here)
   └─ Else: proceed
   │
   ▼
D4 (Coordinate plane axis + artefact-review cleanup) ──► commit ──► WIP inspection (≤ 5 min)
   │
   ├─ If `rg "EntityCoordinate" packages/` returns > 5 consumer sites: halt;
   │  re-decompose into D4a (type extension) + D4b (consumer migration)
   ├─ If walk test fails on any of SQL/Mongo/Postgres concretions: halt;
   │  debug — the structural walk plus `plane: 'storage'` must hold uniformly
   └─ Else: re-open the slice PR (or update existing PR) with D4 in scope
```

## Per-dispatch DoR overlay (team)

Pre-flight items the `drive-build-workflow` brief MUST include for each dispatch in this slice (in addition to the canonical per-dispatch DoR):

- [x] Brief references applicable failure-mode entries from [`drive/calibration/failure-modes.md`](../../../../drive/calibration/failure-modes.md) — D1: F2, F4, F5; D2: F1, F4, F5
- [x] Brief references applicable grep-library entries from [`drive/calibration/grep-library.md`](../../../../drive/calibration/grep-library.md) — both dispatches: § IR substrate hygiene
- [x] Brief specifies the slice plan path `projects/contract-ir-planes/slices/substrate/plan.md`
- [x] Brief's edge-case table includes F5 "destructive git operations forbidden without orchestrator approval" disposition
- [x] Affected packages identified for `pnpm build` cascade — D1 changes `packages/1-framework/1-core/framework-components` → downstream `pnpm build` of `packages/2-sql/1-core/contract`, `packages/2-mongo-family/1-foundation/mongo-contract`, `packages/2-sql/9-family`, `packages/3-targets/3-targets/postgres`; D2 changes `packages/1-framework/1-core/framework-components` (descriptor type) → same downstream cascade
- [x] Fixture-regeneration decision: **none** for this slice (no on-disk shape change); `pnpm fixtures:check` is a "no drift permitted" gate
- [x] Downstream package builds named as "done when" gates: SQL contract, Mongo contract, SQL family, Postgres target, Postgres adapter
- [x] New public type addition: D1 adds `EntityCoordinate` (type) and `elementCoordinates(storage)` (free function); the `Storage` interface itself stays unchanged; downstream typecheck named as gate
