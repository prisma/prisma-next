# D3 — Vocabulary cleanup + structural walk (S1.A)

> **Status (orchestrator hand-off, 2026-05-21):** D1 + D2 of slice S1.A shipped on branch `tml-2584-s1a-substrate`; PR #552 opened. User flagged two compounding design issues at slice-PR-open time. This dispatch lands the corrections **before the slice's PR merges**, so the substrate ships clean.

## Authoritative inputs

- Slice spec (post-rewrite): [`projects/contract-ir-planes/slices/substrate/spec.md`](../spec.md) — **read § At a glance "Vocabulary note" + § In scope + § Approach D3 in full before starting**
- Slice plan (post-rewrite): [`projects/contract-ir-planes/slices/substrate/plan.md`](../plan.md) § Dispatch 3
- Project plan: [`projects/contract-ir-planes/plan.md`](../../../plan.md) § S1.A
- Project ADR (post-rewrite): [`projects/contract-ir-planes/adrs/0001-contract-planes.md`](../../../adrs/0001-contract-planes.md) — Decisions 3 and 5
- Failure modes: [`drive/calibration/failure-modes.md`](../../../../../drive/calibration/failure-modes.md) — **F1 (relocated dual shape) is load-bearing this dispatch**
- Grep library: [`drive/calibration/grep-library.md`](../../../../../drive/calibration/grep-library.md) § IR substrate hygiene
- Retro context: [`drive/retro/findings.md`](../../../../../drive/retro/findings.md) — the 2026-05-21 entry on inherited "decided" fields is the meta-finding this dispatch validates

## Why this dispatch exists (pushback context)

When PR #552 opened, the user surfaced two compounding issues inherited from D1's framing and propagated by D2's brief:

1. **"Slot key" is redundant with `entityKind` / `discriminator`.** The descriptor's `storageSlotKey` field and the `entityKind` field in the D1 lookup table carried the same string in every entry. The codebase already names this concept (the kind's `discriminator`, e.g. `'postgres-enum'`); inventing a second name produced one redundant field on the descriptor surface, a parallel slot-keyed hydration registry on the family base, a `FamilyDescriptor.reservedStorageSlotKeys` field, and a slot-name collision validator — all solving a problem the existing `discriminator` field already solved.
2. **The walk doesn't need any up-front knowledge of slot names.** Contract hydration (family-specific, runs before the walk) has already enforced the structural shape of each namespace. The walk's job is enumeration; it can iterate own-enumerable entity-bearing properties structurally and yield one tuple per entry. The family-name-keyed lookup table that shipped (`SLOT_KEYS_BY_NAMESPACE_KIND`) hardcoded `'sql-namespace'` and `'mongo-namespace'` into the framework layer (layering violation) and silently failed for Postgres-promoted namespaces whose runtime `kind` is `'schema'` (not `'sql-namespace'`).

D3 lands the corrections at the smallest cost — touching only the surface introduced in D1 + D2, retiring it cleanly, and updating the JSDoc invariant the structural walk relies on.

## Intent (one paragraph)

Replace `elementCoordinates`'s family-name-keyed lookup with a structural property walk over each namespace's own-enumerable entity-bearing properties (skipping `id` as a known scalar; `kind` is non-enumerable per the IR-class pattern and auto-skips). Drop the `storageSlotKey?` field from `AuthoringEntityTypeDescriptor`. Collapse the parallel `namespaceSlotHydrationRegistry` constructor parameter + field + `hydrateNamespaceSlot` helper from `SqlContractSerializerBase` and `MongoContractSerializerBase`; the existing `entityTypeRegistry: Map<discriminator, factory>` becomes the single source of truth for entry hydration. Update `hydrateSqlNamespaceEntry` (and the Mongo equivalent) to iterate the raw namespace envelope's properties: family built-ins (`tables` for SQL, `collections` for Mongo) hydrate through the existing hardcoded family construction; every other entity-bearing property iterates its entries and dispatches each through `entityTypeRegistry.get(entry.kind)`. Drop `FamilyDescriptor.reservedStorageSlotKeys` (and its `ControlStack` thread-through). Delete the slot-name collision validator and its unit test. Update `postgresAuthoringEntityTypes.enum` to drop `storageSlotKey: 'types'`; the descriptor's `discriminator: 'postgres-enum'` is what the registry now looks up under. Re-key validator-fragment composition (`createSqlContractSchema`, Mongo equivalent) on `discriminator`. Update the `Namespace` interface JSDoc to declare the invariant the structural walk relies on. **No on-disk contract changes**; **byte-stability gate holds**; **the hardcoded SQL `'types?'` validator slot stays** (F1 cure — additive coexistence; S1.B drops it).

## Decisions already settled (do NOT relitigate)

| Decision | Resolution | Where settled |
|---|---|---|
| Walk dispatch shape | Structural property iteration over namespace own-enumerable properties | Spec § "Why structural property iteration" + § Approach D3 step 1 |
| Single registry source of truth | The existing `entityTypeRegistry: Map<discriminator, factory>` | Spec § Approach D3 step 3; ADR Decision 5 (re-keyed by `discriminator`) |
| `storageSlotKey?` retirement | Field removed; descriptor's existing `discriminator` is the registry key | Spec § Approach D3 step 2; ADR Decision 5 |
| `reservedStorageSlotKeys` retirement | Family-descriptor field removed (along with thread-through) | Spec § Approach D3 step 4 |
| Slot-name collision validator | Deleted (with its unit test) | Spec § Approach D3 step 5 |
| Validator-composition keying | Re-keyed on `discriminator` (was `storageSlotKey`) | Spec § Approach D3 step 7 |
| Hardcoded SQL `'types?'` slot | Stays (additive coexistence; F1 cure) | Spec edge "SQL family validator's hardcoded enum `types?` entry stays alongside the composition surface" |

Halt and surface if any of these need re-discussion — that's design judgment beyond D3's scope.

## Files in play (~13)

### Framework layer

1. **`packages/1-framework/1-core/framework-components/src/ir/storage.ts`**
   Remove `SLOT_KEYS_BY_NAMESPACE_KIND` (lines 10–22) entirely. Replace the lookup-driven `elementCoordinates` body with a structural property walk. Reference implementation shape:

   ```ts
   export function* elementCoordinates(storage: Storage): Generator<EntityCoordinate> {
     for (const [namespaceId, ns] of Object.entries(storage.namespaces)) {
       for (const [entityKind, slot] of Object.entries(ns)) {
         if (entityKind === 'id') continue;
         if (slot === null || typeof slot !== 'object') continue;
         for (const entityName of Object.keys(slot)) {
           yield { namespaceId, entityKind, entityName };
         }
       }
     }
   }
   ```

   Notes:
   - `kind` is non-enumerable on every namespace concretion (set via `Object.defineProperty(this, 'kind', { value, enumerable: false })`), so it doesn't appear in `Object.entries(ns)`. Verify this is true for **every** namespace concretion before relying on it (grep is in the "Verification" section below); if any concretion sets `kind` enumerably, fix that first (and add it to the grep gate going forward).
   - Skipping `id` is by name because `id` is enumerable on namespace concretions.
   - The `typeof slot !== 'object'` guard catches any future scalar own-enumerable field a namespace concretion might carry; today only `id` qualifies.
   - The unrecognised-kind throw is **gone** — there's no kind to recognise; the walk just enumerates.

2. **`packages/1-framework/1-core/framework-components/src/ir/namespace.ts`**
   Update the `Namespace` interface JSDoc to declare the structural-walk invariant. Suggested wording (refine to fit the file's existing tone):

   > Every namespace concretion (e.g. `SqlNamespacePayload`, `MongoNamespacePayload`, target-promoted namespaces like `PostgresSchema`) carries exactly: `id` (enumerable string), `kind` (non-enumerable string discriminator set via `Object.defineProperty`), and one or more **entity-kind slot maps** — each an own-enumerable property whose key is the entity kind (`tables`, `types`, `collections`, target-pack-contributed slot names) and whose value is a `Record<entityName, EntityIRClass>`. No other own-enumerable data lives on a namespace; non-entity computed data lives on the surrounding storage or contract IR. The framework's `elementCoordinates(storage)` walk relies on this invariant to enumerate entities structurally without family-specific knowledge.

3. **`packages/1-framework/1-core/framework-components/src/shared/framework-authoring.ts`**
   Drop the `storageSlotKey?: string` field from `AuthoringEntityTypeDescriptor` (lines 142–158 in the current file). Update the JSDoc on `hydrate?` and `validatorSchema?` to name the descriptor's `discriminator` as the registry key the family base looks up under. Example for `hydrate?`:

   > Hydration factory the family `ContractSerializer` invokes for each entry whose envelope `kind` matches this descriptor's `discriminator`. Receives the raw JSON value (post-structural-validation) and returns the IR-class instance. Idempotent: already-class instances pass through unchanged is the caller's contract.

   Same pattern for `validatorSchema?` — name `discriminator` as the keying coordinate. **No removal of `hydrate?` or `validatorSchema?`** — those fields stay; only `storageSlotKey?` retires.

4. **`packages/1-framework/1-core/framework-components/src/shared/framework-components.ts`**
   Drop `reservedStorageSlotKeys` from `FamilyDescriptor` (or wherever the field lives — grep with `rg 'reservedStorageSlotKeys' packages/1-framework/`). Drop any re-export lines for the symbol.

5. **`packages/1-framework/1-core/framework-components/src/control/control-stack.ts`**
   Drop the `reservedStorageSlotKeys` thread-through (the `ifDefined`-style pass-through added in commit `3b00fc3e4`).

6. **`packages/1-framework/1-core/framework-components/test/control-stack.test.ts`**
   Drop the `reservedStorageSlotKeys` test (added with D2 step 8). If the file becomes empty or only contains scaffolding, leave the file with whatever other tests already lived there before D2 — do NOT delete the file.

### Family layer

7. **`packages/2-sql/9-family/src/core/control-descriptor.ts`**
   Remove `reservedStorageSlotKeys: ['tables']` from the SQL family descriptor.

8. **`packages/2-mongo-family/9-family/src/core/control-descriptor.ts`**
   Remove `reservedStorageSlotKeys: ['collections']` from the Mongo family descriptor.

9. **`packages/2-sql/9-family/src/core/ir/sql-contract-serializer-base.ts`**
   - Remove the `namespaceSlotHydrationRegistry` constructor parameter, the private field, and the `hydrateNamespaceSlot` protected helper (lines 28, 57–60, 65, 68, 170–201 today).
   - Remove the `SqlNamespaceSlotHydrationFactory` type alias (line 28) — no consumer left.
   - The remaining constructor signature: `constructor(private readonly entityTypeRegistry: ReadonlyMap<string, SqlEntityHydrationFactory>, validatorFragments?: ReadonlyMap<string, Type<unknown>>)`. Shift the existing third positional argument to second.
   - Rewrite `hydrateSqlNamespaceEntry` to iterate the raw envelope's own-enumerable properties structurally:
     - `tables` slot: hydrate via the existing hardcoded `StorageTable` construction (unchanged).
     - For every other entity-bearing property (the legacy `types` slot today; future pack-contributed slots), iterate `Object.entries(slot)`. For each entry, look up `entry.kind` in `this.entityTypeRegistry`; if found, hydrate via the factory; if not found, pass the entry through unchanged (preserves today's pass-through behaviour for unknown kinds, which the existing `hydrateStorageTypeEntry` already does at line 211).
     - The `ContractValidationError` throw (lines 145–154) for "per-schema database types require `PostgresContractSerializer`" stays — but now it fires when `entityTypeRegistry.get('postgres-enum') === undefined`, not when `namespaceSlotHydrationRegistry.get('types') === undefined`. (The error message stays the same; the precondition that triggers it shifts to the kind-keyed registry.)
   - `validatorFragments` constructor parameter stays, **but** its keying changes: it now maps `discriminator → Type<unknown>` (was `storageSlotKey → Type<unknown>`). Update the `createSqlContractSchema(validatorFragments)` call site accordingly (the signature changes — see file 12 below).
   - Update the `SqlEntityHydrationFactory` type alias's JSDoc to reflect that it's the single hydration coordinate for both legacy `storage.types` entries and pack-contributed namespace-slot entries.

10. **`packages/2-mongo-family/9-family/src/core/ir/mongo-contract-serializer-base.ts`**
    Symmetric collapse to file 9. Built-in slot is `collections`; everything else is structural.

### Target layer

11. **`packages/3-targets/3-targets/postgres/src/core/postgres-contract-serializer.ts`**
    The existing enum-branch override in `hydrateSqlNamespaceEntry` should now look identical in behaviour to the family-base default (the family base's structural iteration handles `'postgres-enum'` through the registry). The override's remaining job is **only** the namespace-class promotion (constructing `PostgresSchema` / `PostgresUnboundSchema` instead of plain literals at lines 68–75). Refactor:
    - Remove the registry lookup against the (now-deleted) `namespaceSlotHydrationRegistry`.
    - Let the family base hydrate `tables` + `types` (via the registry's `'postgres-enum'` factory) structurally.
    - Wrap the resulting hydrated entries in `PostgresSchema` / `PostgresUnboundSchema` at the namespace-promotion step (existing logic at lines 68–75 stays).
    - The `super(...)` constructor call: drop the `namespaceSlotHydrationRegistry` argument; the Postgres serializer's `entityTypeRegistry` already contains `'postgres-enum' → new PostgresEnumType(...)`, so the hydration round-trip is identical.

12. **`packages/3-targets/3-targets/postgres/src/core/authoring.ts`**
    Drop `storageSlotKey: 'types'` from `postgresAuthoringEntityTypes.enum` (line 52 in the current file). Update the surrounding comment block (lines 47–51) to describe the descriptor's `discriminator: 'postgres-enum'` as the registry key the family base looks up the `hydrate` callback under. The `hydrate` and `validatorSchema` fields stay.

### Validators

13. **`packages/2-sql/1-core/contract/src/validators.ts`**
    - Drop the slot-name collision validator added in D2 step 8 (find via `rg 'storageSlotKey' packages/2-sql/1-core/contract/`).
    - Re-key `createSqlContractSchema(validatorFragments)` to accept `ReadonlyMap<discriminator, Type<unknown>>` and fold contributed fragments into the per-namespace entry schema keyed by the entry's `kind` field. The hardcoded `'types?': type({ '[string]': PostgresEnumTypeSchema })` block (line 168) **stays untouched** — additive coexistence; F1 cure.

14. **`packages/2-mongo-family/1-foundation/mongo-contract/src/contract-schema.ts`**
    Symmetric re-keying to file 13. `MongoNamespaceEnvelopeSchema` composition surface accepts fragments keyed by `discriminator`. No-op for Mongo today (no pack contributions); symmetry only.

## Done when

- [ ] `pnpm typecheck` clean — `storageSlotKey`, `reservedStorageSlotKeys`, `namespaceSlotHydrationRegistry`, `SLOT_KEYS_BY_NAMESPACE_KIND` all removed; consumers compile against the collapsed surface
- [ ] `pnpm test:packages` green — entry hydration round-trips byte-identically through the single `entityTypeRegistry`; the Mongo validator-composition surface stays no-op
- [ ] `pnpm test:integration` green — **end-to-end Postgres enum hydration still works** through the registry (load-bearing exemplar; the prior parallel-registry path and the new single-registry path must round-trip identically to today)
- [ ] `pnpm lint:deps` clean — structural walk removes the framework→family lookup-table layering violation; layering enforcement remains green
- [ ] `pnpm fixtures:check` clean — **byte-stability gate holds**; no on-disk contract changes
- [ ] **Vocabulary-retirement grep gates (load-bearing this dispatch):**
  ```bash
  rg 'storageSlotKey' packages/                    # expect: zero hits
  rg 'reservedStorageSlotKeys' packages/           # expect: zero hits
  rg 'namespaceSlotHydrationRegistry' packages/    # expect: zero hits
  rg 'SLOT_KEYS_BY_NAMESPACE_KIND' packages/       # expect: zero hits
  rg 'hydrateNamespaceSlot' packages/              # expect: zero hits
  rg 'SqlNamespaceSlotHydrationFactory' packages/  # expect: zero hits
  ```
- [ ] **Structural-walk invariant verification:** every namespace concretion sets `kind` non-enumerably. Verify:
  ```bash
  rg "defineProperty\(this,\s*'kind'" packages/   # expect: every namespace concretion uses defineProperty with enumerable: false
  rg "readonly kind\s*=" packages/                # expect: zero hits on namespace concretion files (would indicate enumerable kind)
  ```
  If any namespace concretion sets `kind` enumerably, fix that first (it would otherwise leak into the walk as a bogus `(ns, 'kind', '<value>')` coordinate).
- [ ] **Postgres-promoted-namespace walk test:** add (or extend) a unit test in `packages/3-targets/3-targets/postgres/test/` that constructs a `PostgresSchema` (whose `kind === 'schema'`), wraps it in a `SqlStorage`, calls `elementCoordinates(storage)`, and asserts the yielded coordinates include the schema's tables. The prior lookup-table walk would have thrown `'unrecognised namespace kind "schema"'`; the structural walk must succeed.
- [ ] **F1 dual-shape grep gate:** `rg 'looksLikeFlat|normalizeStorageForHydration|stampNamespaceOnTable|normalizeStorageEnvelopeShape|isFlatTablesInput|isFlatTypesInput' packages/` returns zero hits (no new dual-shape relocation introduced under the cover of the cleanup)
- [ ] **Intent-validation:** `git diff --stat origin/main..HEAD -- packages/` shows ≤ 18 files in `packages/` for D3's diff (the 13 enumerated above + tolerance for incidental import-line adjustments)
- [ ] All commits explicitly staged (`git add <specific-paths>` only; never `git add -A` / `git add .`)
- [ ] Per-commit messages reference D3, the slice spec path (`projects/contract-ir-planes/slices/substrate/spec.md`), and TML-2584

## Scope guardrails (hard-line)

If you find yourself reaching for any of these, **escalate** — they're out:

- ❌ Renaming `storage.<ns>.types` to `storage.<ns>.postgresEnums` anywhere — S1.B
- ❌ Removing the hardcoded `'types?': type({ '[string]': PostgresEnumTypeSchema })` line from `NamespaceEntrySchema` — F1 cure violation
- ❌ Touching `extractStorageElementNames` (migration-loader walker) — S1.D
- ❌ Modifying any `'postgres-enum'` discriminator literal sites — out per spec
- ❌ Editing the `Storage` interface — it stayed unchanged in D1/D2 and stays unchanged here
- ❌ Adding any new fields to `AuthoringEntityTypeDescriptor` — the surface this dispatch lands on is final: `kind` + `discriminator` + `args` + `output` + `hydrate?` + `validatorSchema?`. Nothing else.
- ❌ Changing the `hydrate?` callback signature (still `(raw: unknown) => Output`)
- ❌ Sharpening `EntityHelperFunction<Descriptor>` to surface enum-specific narrowing — explicitly deferred per the existing block comment in `postgres/authoring.ts`
- ❌ Destructive git operations (F5): `git clean -f*`, `git reset --hard`, `git stash drop`, `git stash clear`, `git checkout -- .`, `rm -rf` against the worktree. If you need to discard work, surface and ask.

## Hard escalation triggers

If any of these fire, **stop and surface immediately** — do not work around them:

1. **Any namespace concretion sets `kind` enumerably** → the walk-invariant grep gate fails; fix the concretion before changing the walk body
2. **`pnpm test:integration` regresses on Postgres enum hydration** → debug before opening any PR; this is the project's load-bearing exemplar
3. **The collapsed `hydrateSqlNamespaceEntry` doesn't preserve byte-identical hydration** (fixture check moves) → halt; the round-trip through the registry must match the prior parallel-registry path exactly
4. **Cascade > 18 files** in `packages/` → exceeds D3 budget; halt and surface
5. **The structural walk needs a defensive cast that didn't exist before** (e.g., `as Readonly<Record<string, unknown>>` reappears) → review; the structural walk should be implementable in pure `Object.entries` terms

## Pre-flight reading (orchestrator-confirmed)

Before editing, ground yourself in the affected surface:

- `packages/1-framework/1-core/framework-components/src/ir/storage.ts` (full file — 99 lines, post-D1)
- `packages/1-framework/1-core/framework-components/src/ir/namespace.ts` (full file)
- `packages/1-framework/1-core/framework-components/src/shared/framework-authoring.ts` L114–L180 (descriptor)
- `packages/2-sql/9-family/src/core/ir/sql-contract-serializer-base.ts` (full file — 222 lines, post-D2)
- `packages/3-targets/3-targets/postgres/src/core/postgres-contract-serializer.ts` (enum branch + namespace promotion logic)
- `packages/3-targets/3-targets/postgres/src/core/authoring.ts` L42–L60 (`postgresAuthoringEntityTypes.enum`)
- `packages/2-sql/1-core/contract/src/validators.ts` L160–L181 + the slot-key collision validator (find via `rg 'storageSlotKey' packages/2-sql/1-core/contract/`)

Then trace **contribution discovery** if the surface is unfamiliar: `rg 'AuthoringContributions' packages/`, `rg 'entityTypes' packages/1-framework/`.

## Commit hygiene

Suggested ordering (small, surgical commits as you go):

1. `refactor(framework-components/ir): structural-walk elementCoordinates over namespace own-enumerable properties`
2. `refactor(framework-components/authoring): drop storageSlotKey from AuthoringEntityTypeDescriptor`
3. `refactor(framework-components,family-sql,family-mongo): drop reservedStorageSlotKeys from FamilyDescriptor + control-stack thread-through`
4. `refactor(family-sql/ir,family-mongo/ir): collapse namespaceSlotHydrationRegistry into entityTypeRegistry`
5. `refactor(sql-contract/validators,mongo-contract/contract-schema): re-key validator-fragment composition on discriminator; drop slot-name collision validator`
6. `refactor(postgres/contract-serializer,postgres/authoring): delegate enum hydration via discriminator-keyed registry; drop storageSlotKey`
7. `test(framework-components,postgres): structural walk handles Postgres-promoted PostgresSchema (kind === 'schema')`

If a commit fails its targeted tests, fix forward in the same commit before moving to the next.

## Reporting back

On DONE, report:
- Commit SHAs (top of branch tip; chain since `550276161`)
- Gate results table (typecheck / test:packages / test:integration / lint:deps / fixtures:check / each vocabulary-retirement grep / structural-walk invariant grep / Postgres-promoted-namespace walk test)
- `git diff --stat origin/main..HEAD -- packages/` for orchestrator's intent-validation walk
- Any judgment calls made (the highest-judgment surfaces this dispatch: the structural walk's defensive guards on `slot` shape, the family-base structural iteration's handling of unknown-kind entries, the `Namespace` interface JSDoc wording)

On HALT, report:
- Exact trigger (which escalation rule fired)
- WIP state (what was modified, whether commits were made, whether the tree is clean)
- Recommended next step

---

**Model tier:** `claude-opus-4-7-thinking-high` per slice plan. The structural walk has design judgment in its defensive guards (what counts as an entity-bearing property; how to handle unknown-kind entries); the JSDoc invariant authoring is creative work; the family-base hydration rewrite requires inference judgment on the registry's keying. Composer-2.5 routed off.

**Branch:** `tml-2584-s1a-substrate` (continue the slice branch; commit on top of `550276161`).
