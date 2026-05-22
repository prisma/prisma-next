# D2 — Descriptor mechanism + Postgres `postgresEnums` registration

> **Status (orchestrator hand-off, 2026-05-20):** Substrate from D1 has shipped on `tml-2584-s1a-substrate` (commits `f148a9d81` … `ec164ece7`). Free `elementCoordinates(storage)` walk + `EntityCoordinate` type + `Namespace.kind` narrowing + `Contract.domain?` are in place; byte-stability gate (`pnpm fixtures:check`) is green. This dispatch lands the second half of slice S1.A.

## Authoritative inputs

- Slice spec: [`projects/contract-ir-planes/slices/substrate/spec.md`](../spec.md)
- Slice plan (this dispatch is § D2): [`projects/contract-ir-planes/slices/substrate/plan.md`](../plan.md) — **read § "Dispatch 2" before starting**
- Parent project plan: [`projects/contract-ir-planes/plan.md`](../../../plan.md)
- Parent project ADR: [`projects/contract-ir-planes/adrs/0001-contract-planes.md`](../../../adrs/0001-contract-planes.md)
- Failure modes: [`drive/calibration/failure-modes.md`](../../../../../drive/calibration/failure-modes.md) — **F1 (relocated dual shape) is load-bearing this dispatch**
- Grep library: [`drive/calibration/grep-library.md`](../../../../../drive/calibration/grep-library.md) § IR substrate hygiene

## Intent (one paragraph)

Extend `AuthoringEntityTypeDescriptor` with three optional fields — `storageSlotKey?`, `hydrate?`, `validatorSchema?` — and install the dispatch infrastructure that consumes them: a parallel hydration registry on `SqlContractSerializerBase` keyed by `storageSlotKey`, a validator-composition surface on the SQL and Mongo family schemas that folds contributed `validatorSchema` fragments at boot, and a `storageSlotKey`-collision validator that rejects pack contributions whose slot names clash with the family's built-in slot names. Postgres pack registers `postgresEnums` via the new descriptor — the slot exists end-to-end but holds **no entries** until S1.B migrates them. **No on-disk contracts change**; **no fixtures regenerate**; the existing hardcoded `'types?'` schema entry in the SQL validator and the existing Postgres serializer enum override **coexist additively** with the new registry path (F1 cure).

## Decisions pre-resolved (do NOT relitigate; use the working position)

These are the slice spec's open questions that this dispatch operationalises. Implement the working position as-stated.

| OQ | Working position | Implementation hint |
|---|---|---|
| **OQ2** (registry shape) | Parallel `Map<storageSlotKey, hydrate>` sibling to the existing `entityTypeRegistry: Map<kind, factory>` on `SqlContractSerializerBase` | Add a second constructor parameter; the existing `entityTypeRegistry` keyed by `kind` stays untouched |
| **OQ3** (descriptor extension shape) | Extend `AuthoringEntityTypeDescriptor<Input, Output>` directly with three optional fields | Do NOT introduce a parallel concept (no new `EntityKindDescriptor` interface, no separate registry type) |
| **OQ5** (validator-fragment composition order) | At validator construction time, fold contributed fragments into the per-namespace entry schema; the hardcoded `'types?'` slot stays and coexists redundantly with the Postgres enum contribution | Both validate the same shape — the redundancy is the F1 cure, not a bug |

## Files in play (~7)

1. **`packages/1-framework/1-core/framework-components/src/shared/framework-authoring.ts`** (L134, descriptor interface)
   Extend `AuthoringEntityTypeDescriptor<Input, Output>` with three optional fields:
   ```ts
   readonly storageSlotKey?: string;
   readonly hydrate?: (raw: unknown) => Output;
   readonly validatorSchema?: Type<unknown>;  // import from arktype
   ```
   **Preserve** the contravariant `output.factory: (input: Input, ctx) => Output` inference contract (the `Input = never` default is load-bearing per the existing block comment at L118–L129). `isAuthoringEntityTypeDescriptor` guard does NOT need updates (new fields are optional, do not affect `kind`/`discriminator`/`output` shape).

2. **`packages/2-sql/1-core/contract/src/validators.ts`** (`NamespaceEntrySchema` L168)
   Convert the inline `const NamespaceEntrySchema = type({…})` into a factory call that composes any pack-contributed `validatorSchema` fragments into a single per-namespace-entry schema. The hardcoded `'types?': type({ '[string]': PostgresEnumTypeSchema })` line **stays in place** (F1 — additive coexistence). Wire the contribution discovery path through the family ContractSerializer's construction site (validator becomes a factory invoked at serializer construction with the gathered contributions).

3. **`packages/2-mongo-family/1-foundation/mongo-contract/src/contract-schema.ts`** (`MongoNamespaceEnvelopeSchema` L320)
   Same composition surface as SQL, no-op for Mongo today (no pack contributions). Symmetry, not behaviour change.

4. **`packages/2-sql/9-family/src/core/ir/sql-contract-serializer-base.ts`**
   Constructor gains a second `ReadonlyMap<string, (raw: unknown) => unknown>` parameter — the namespace-slot hydration registry keyed by `storageSlotKey`. In `hydrateSqlNamespaceEntry`, after the brand-check shortcut, iterate the registry and hydrate any slot keys present on the raw envelope. Existing `entityTypeRegistry: Map<kind, factory>` (storage-level types) stays untouched and unchanged in shape.

5. **`packages/3-targets/3-targets/postgres/src/core/postgres-contract-serializer.ts`**
   Refactor the existing `hydrateSqlNamespaceEntry` override so the enum-branch (L46–L64) delegates to the new family-base registry path instead of inlining the `new PostgresEnumType(...)` construction. Pass the `postgresEnums` hydrator into `super(...)` via the new constructor parameter. The serializer's namespace-promotion logic (PostgresSchema instantiation at L68–L75) stays as-is — only the per-slot enum hydration moves to the registry. The `serializeContract` override (L78+) is **out of scope**.

6. **`packages/3-targets/3-targets/postgres/src/core/authoring.ts`** (L42–L51, `postgresAuthoringEntityTypes.enum`)
   Populate the descriptor with all three new fields:
   - `storageSlotKey: 'types'` — **today's slot key per spec edge #8**; renames to `'postgresEnums'` in S1.B
   - `hydrate: (raw) => new PostgresEnumType(raw as PostgresEnumTypeInput)`
   - `validatorSchema: PostgresEnumTypeSchema` — re-export from `@prisma-next/sql-contract/validators` for now (full extraction is S1.B's work; today the symbol lives in validators.ts)

   **NOTE on slot key**: per slice spec edge #8 and slice plan D2's "What stays the same", entries continue to flow through `storage.<ns>.types` in this slice. Slot key `'types'` matches today's reality; `'postgresEnums'` is the S1.B rename target. Using `'types'` here means the registry path round-trips identically to today's override behaviour — which is exactly what makes this a no-op refactor at runtime.

7. **`packages/3-targets/3-targets/postgres/src/core/descriptor-meta.ts`** — likely no change expected; descriptor registration flows through the existing `authoring.entityTypes` slot. **Verify; do not introduce edits if not needed.**

**Plus one new validator** (in scope, not optional polish — spec edge #10):

8. Add a check at descriptor-collection time that rejects pack contributions whose `storageSlotKey` matches a family built-in slot name (`'tables'` for SQL; `'collections'` for Mongo). Surface as a clear `ContractValidationError` at registration. Co-locate with the existing authoring-contribution collection logic (find it via `rg 'AuthoringContributions' packages/`).

## Done when

All gates must pass before completion:

- [ ] `pnpm typecheck` clean — descriptor extension preserves the contravariant inference contract; existing pack contributions compile unchanged
- [ ] `pnpm test:packages` green — validator composition is genuinely no-op for non-contributing families; for Postgres, the registry path produces byte-identical hydration to today's override (write one unit test asserting this if a clean fixture is available)
- [ ] `pnpm test:integration` green — **end-to-end Postgres path still hydrates enums correctly**; this is the project's load-bearing exemplar
- [ ] `pnpm lint:deps` clean — no new framework-imports-family violations
- [ ] `pnpm fixtures:check` clean — **byte-stability gate; no fixture should change**
- [ ] **F1 grep gate (load-bearing this dispatch):**
  ```bash
  rg 'looksLikeFlat|normalizeStorageForHydration|stampNamespaceOnTable|normalizeStorageEnvelopeShape|isFlatTablesInput|isFlatTypesInput' packages/
  ```
  Must return zero hits. If you introduce a new function whose body "detects the legacy enum-in-types shape," **stop and escalate** — that's F1 in this dispatch's territory.
- [ ] Spec edge #10 grep: search the repo for any `storageSlotKey` value that equals `'tables'` or `'collections'` in test code that exercises the new collision validator — at least one test must demonstrate the rejection
- [ ] Intent-validation: descriptor-extension fields are all optional (`?` suffix); existing pack contributions in `examples/` and other `packages/3-extensions/` files compile without changes
- [ ] No edits outside the enumerated files in `packages/` (audit with `git diff --stat`)

## Scope guardrails (hard-line)

These are NOT in scope. If you find yourself reaching for any of them, escalate.

- ❌ Renaming `storage.<ns>.types` to `storage.<ns>.postgresEnums` anywhere — that's S1.B's job
- ❌ Removing the hardcoded `'types?': type({ '[string]': PostgresEnumTypeSchema })` line from `NamespaceEntrySchema` — that's the F1 cure violation
- ❌ Touching `extractStorageElementNames` (migration-loader walker) — S1.D
- ❌ Modifying any `'postgres-enum'` discriminator literal sites — out per spec
- ❌ Editing the `Storage` interface — it stayed unchanged in D1 and stays unchanged here
- ❌ Replacing the inline `SLOT_KEYS_BY_NAMESPACE_KIND` lookup in `elementCoordinates(storage)` with a descriptor-registry lookup — out for this slice (S1.D when the walk becomes load-bearing)
- ❌ Sharpening `EntityHelperFunction<Descriptor>` to surface enum-specific narrowing — explicitly deferred per `postgresAuthoringEntityTypes` block comment (L30–L41)
- ❌ Touching the SQLite target's `PostgresEnumStorageEntry` imports — Tier 3 deferred per slice spec
- ❌ Destructive git operations (F5): `git clean -f*`, `git reset --hard`, `git stash drop`, `git stash clear`, `git checkout -- .`, `rm -rf` against the worktree. If you need to discard work, surface and ask.

## Hard escalation triggers

If any of these fire, **stop and surface immediately** — do not work around them:

1. **Registry shape needs a third Map keyed by something new** — that signals OQ2 needs re-discussion, not in-dispatch expansion
2. **Validator-composition wiring requires fundamental restructuring** of the validator entry-point API beyond `validateSqlContractFully` and the family ContractSerializer constructor — surface so we can scope it as its own dispatch
3. **F1 grep gate fires** — even one hit means a dual shape leaked in
4. **`pnpm test:integration` regresses on Postgres enum hydration** — debug before opening any PR; this is the load-bearing exemplar
5. **Cascade > 15 files** in `packages/` — exceeds D2 budget; halt and surface
6. **Any contract.json or contract.d.ts fixture changes** — byte-stability violation; investigate before continuing

## Pre-flight reading (orchestrator-confirmed)

Before editing, read these to ground your judgment (orchestrator has confirmed the structural shape; you confirm the local detail):

- `packages/1-framework/1-core/framework-components/src/shared/framework-authoring.ts` L114–L165 (descriptor surface)
- `packages/2-sql/1-core/contract/src/validators.ts` L160–L181 (NamespaceEntrySchema + StorageSchema)
- `packages/2-mongo-family/1-foundation/mongo-contract/src/contract-schema.ts` L320–L325 (MongoNamespaceEnvelopeSchema)
- `packages/2-sql/9-family/src/core/ir/sql-contract-serializer-base.ts` (full file — 147 lines)
- `packages/3-targets/3-targets/postgres/src/core/postgres-contract-serializer.ts` L18–L76 (enum-branch override)
- `packages/3-targets/3-targets/postgres/src/core/authoring.ts` L42–L51 (postgresAuthoringEntityTypes.enum)

Then trace **contribution discovery**: search `rg 'AuthoringContributions' packages/` and `rg 'entityTypes' packages/1-framework/` to find where pack contributions are gathered and where they reach the family ContractSerializer. This wiring is the implementation-judgment site for the validator-composition surface.

## Commit hygiene

Make small, surgical commits as you go. Suggested ordering:

1. `feat(framework-components/authoring): add three optional fields to AuthoringEntityTypeDescriptor`
2. `feat(sql-contract,mongo-contract/validators): factor namespace-entry schemas as composable factories`
3. `feat(family-sql/ir): add namespace-slot hydration registry alongside entity-type registry`
4. `feat(postgres/contract-serializer): delegate enum hydration to family-base registry`
5. `feat(postgres/authoring): register postgresEnums via storageSlotKey + hydrate + validatorSchema`
6. `feat(framework-authoring): reject pack contributions whose storageSlotKey collides with family built-ins`

If a commit fails its targeted tests, fix forward in the same commit before moving to the next.

## Reporting back

On DONE, report:
- Commit SHAs (top of branch tip; chain since `ec164ece7`)
- Gate results table (typecheck / test:packages / test:integration / lint:deps / fixtures:check / F1 grep)
- `git diff --stat origin/main..HEAD -- packages/` for orchestrator's intent-validation walk
- Any judgment calls made on validator-composition wiring (this is the highest-judgment surface in the dispatch)
- Any open questions surfaced during implementation that the orchestrator/reviewer should weigh in on

On HALT, report:
- Exact trigger (which escalation rule fired)
- WIP state (what was modified, whether commits were made, whether the tree is clean)
- Recommended next step (e.g. "re-decompose OQ2 in discussion mode")

---

**Model tier:** `claude-opus-4-7-thinking-high` per slice plan model-tier table. Substrate change with TypeScript inference judgment + arktype composition design — Composer-2.5 routed off because the validator-composition wiring is creative work.

**Branch:** `tml-2584-s1a-substrate` (no new branch — continue the slice branch).
