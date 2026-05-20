# Slice Plan: substrate (S1.A)

**Slice spec:** [`./spec.md`](./spec.md)
**Parent plan:** [`projects/contract-ir-planes/plan.md`](../../plan.md) § S1.A
**Linear:** [TML-2584](https://linear.app/prisma-company/issue/TML-2584) (parent; no slice ticket per no-sub-issues rule)

## At a glance

Two dispatches, sequential. D1 lands the framework type primitives behind the rest of the project (no descriptor consumer yet). D2 extends the descriptor surface, wires generic dispatch through the family base, and registers the Postgres pack's `postgresEnums` slot. Slice ships as one PR.

Both dispatches are **M** per [`drive/calibration/sizing.md`](../../../../drive/calibration/sizing.md). Both route to **Opus** per [`drive/calibration/model-tier.md`](../../../../drive/calibration/model-tier.md) — both are substrate / spec-interpretation work (the table's first row). Mechanical sub-portions inside each dispatch are still inside the dispatch's bounds; no sub-dispatch routes to a cheap tier.

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

## Sanity checks

- [x] Each dispatch sized S/M (no L/XL); D1 has a re-decomposition trigger at >30 files cascaded
- [x] Each "Done when" is binary + verifiable (specific commands; specific grep patterns; specific edge case references)
- [x] Every slice-spec edge case mapped to a covering dispatch:
  - Edges #1, #2, #3, #4, #5, #6, #11 (fixtures:check byte-stability) → D1
  - Edges #7 (Mongo no-op), #8, #9, #10 → D2
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
   └─ Else: open PR
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
