# Slice: substrate (S1.A)

_Parent project: [`projects/contract-ir-planes/`](../../). This slice delivers the foundation every other contract-ir-planes slice consumes — see plan § S1.A._

## At a glance

Add the framework-level type primitives the rest of the project consumes — a `domain` plane on the framework `Contract` type, a narrowed `Namespace` interface, family-shaped namespace types carrying the family-specific slots, and a polymorphic free-function `elementCoordinates(storage)` walk — and extend `AuthoringContributions.entityTypes` so target packs can contribute new entity-kind slots through a single descriptor. Postgres pack registers a `postgresEnums` slot through the new descriptor as proof the wiring works end-to-end. No on-disk contract changes; enum entries continue to flow through the existing framework-shared `storage.<ns>.types` slot (S1.B migrates them).

## Scope

### In scope

**Framework type primitives** (`packages/1-framework/`):

- `Contract` type ([`packages/1-framework/0-foundation/contract/src/contract-types.ts`](../../../../packages/1-framework/0-foundation/contract/src/contract-types.ts)) gains an optional `domain` field at the root, typed as `Record<NamespaceId, Record<EntityKind, Record<EntityName, unknown>>>` (precise typing layered in by family packs). Existing flat `models` / `valueObjects` siblings stay — populating `domain` is S1.C's job; this slice only adds the type.
- `Namespace` interface ([`packages/1-framework/1-core/framework-components/src/ir/namespace.ts`](../../../../packages/1-framework/1-core/framework-components/src/ir/namespace.ts)) narrows to required `{ id: string; kind: string }`. `kind` is promoted from optional on `IRNode` to required on `Namespace`. `NamespaceBase` requires concrete classes to declare `kind` (today they set it via non-enumerable `Object.defineProperty`; that pattern is preserved — only the interface shape changes).
- `Storage` interface ([`packages/1-framework/1-core/framework-components/src/ir/storage.ts`](../../../../packages/1-framework/1-core/framework-components/src/ir/storage.ts)) stays unchanged. A new free function `elementCoordinates(storage): Generator<EntityCoordinate>` is exported from the same module, dispatched on `Namespace.kind` (initially via an inline `Map<namespaceKind, slotKeys>` lookup table; D2 replaces the table with the pack-contributed descriptor registry). `EntityCoordinate` is a new exported type `{ namespaceId: string; entityKind: string; entityName: string }`. Walks the built-in family slots (`tables`/`types` for `'sql-namespace'`, `collections` for `'mongo-namespace'`); pack-contributed slots become walkable as D2 wires the registry.
- New `EntityCoordinate` type co-located with `Storage` (settled per spec OQ1 working position).

> **Why a free function, not a method on `Storage`.** Adding the walk as a required member of the `Storage` interface (the original R1 design) broke structural assignability of emitted `contract.d.ts` storage literals against `Contract<SqlStorage>` consumers: the printed literal carries `storageHash`/`namespaces`/`types?` but no method members, so promoting the interface broke every fixture's structural match. The free function consumes any `Storage`-shaped value, dispatches polymorphically via the lookup table (and later the descriptor registry), and leaves the interface — and every emitted artefact's structural conformance — untouched. See the slice plan's R2 redirect note and the D1 dispatch brief for the full rationale.

**Family-shaped namespace types** (move family-specific slots off the framework interface):

- `SqlNamespace` type alias ([`packages/2-sql/1-core/contract/src/ir/sql-storage.ts`](../../../../packages/2-sql/1-core/contract/src/ir/sql-storage.ts)) was already `Namespace & { tables, types? }`; nothing structural changes here, but the typing now reflects the narrowed framework `Namespace`. `MongoNamespace` ([`packages/2-mongo-family/1-foundation/mongo-contract/src/ir/mongo-storage.ts`](../../../../packages/2-mongo-family/1-foundation/mongo-contract/src/ir/mongo-storage.ts)) similarly unchanged structurally — the framework narrowing makes the family extension explicit.
- The framework canonicalizer's `TOP_LEVEL_ORDER` ([`packages/1-framework/0-foundation/contract/src/canonicalization.ts`](../../../../packages/1-framework/0-foundation/contract/src/canonicalization.ts) L17–L31) gains `domain` as a top-level key. The SQL-specific `storage.namespaces.*` path checks (L70–L167, L231–L273) stay unchanged in this slice — they're S1.B's problem (when the slot shape moves) and S1.D's problem (when the family-contribution hook lands).

**Descriptor mechanism** (`AuthoringContributions.entityTypes` extension):

- [`packages/1-framework/1-core/framework-components/src/shared/framework-authoring.ts`](../../../../packages/1-framework/1-core/framework-components/src/shared/framework-authoring.ts) — extend `AuthoringEntityTypeDescriptor<Input, Output>` to carry three new fields alongside the existing `kind`, `discriminator`, `args`, `output`:
  - `storageSlotKey?: string` — where in `storage.<ns>.<slotKey>` the pack's entries live. Omitted means the kind is authoring-only (today's enum behaviour, kept as a fallback to avoid breaking the existing contract).
  - `hydrate?: (raw: unknown) => Output` — serializer hydration factory the framework can call generically.
  - `validatorSchema?: ArkSchema` — schema fragment the family validator composes into its namespace-entry schema. Mongo validator's `MongoNamespaceEnvelopeSchema` and SQL validator's `NamespaceEntrySchema` learn to compose contributed fragments at startup.
- Postgres pack ([`packages/3-targets/3-targets/postgres/src/core/authoring.ts`](../../../../packages/3-targets/3-targets/postgres/src/core/authoring.ts)) updates its existing `enum` entry-type descriptor to populate the three new fields: `storageSlotKey: 'postgresEnums'`, `hydrate: (raw) => new PostgresEnumType(raw)`, `validatorSchema: PostgresEnumTypeSchema` (re-exported from the SQL validator's existing hardcoded schema for now — full extraction is S1.B's job).

**Generic dispatch through the descriptor registry**:

- SQL family base serializer ([`packages/2-sql/9-family/src/core/ir/sql-contract-serializer-base.ts`](../../../../packages/2-sql/9-family/src/core/ir/sql-contract-serializer-base.ts)) already accepts an `entityTypeRegistry: Map<kind, factory>` for `storage.types` entries. Extend the constructor (or sibling registry) to also accept pack-contributed entity-kind hydration factories addressed by `storageSlotKey`. The Postgres pack's existing ad-hoc `hydrateSqlNamespaceEntry` enum branch ([`packages/3-targets/3-targets/postgres/src/core/postgres-contract-serializer.ts`](../../../../packages/3-targets/3-targets/postgres/src/core/postgres-contract-serializer.ts)) is reachable through the registry by the end of this slice — but is NOT yet the only path; the existing enum-in-`types`-slot path continues to work because no on-disk contracts move.
- Family validator schema composition: SQL and Mongo validators learn to fold contributed `validatorSchema` fragments into their per-namespace entry schemas at framework boot. For SQL, today's hardcoded `'types?': type({ '[string]': PostgresEnumTypeSchema })` ([`packages/2-sql/1-core/contract/src/validators.ts`](../../../../packages/2-sql/1-core/contract/src/validators.ts) L168) is preserved as-is in this slice — the contributed-fragment composition exists alongside it as a no-op for SQL (no pack actually populates `postgresEnums` yet). S1.B is where SQL drops the hardcoded `types?` enum slot.

### Out of scope (this slice)

- **Moving enum entries off the `storage.<ns>.types` slot** — S1.B does this. The `'postgres-enum'` literal in 32 files stays; `PostgresEnumStorageEntry` imports stay; SQLite's three rejection-path imports stay.
- **Cross-reference encoding migration** to object pairs (`relation.to`, `model.base`, `roots[*]`) — S1.C.
- **Deletion of subsumed surfaces** — `findSqlTable`, `assertUniqueSqlTableNames`, `extractStorageElementNames`, `SqlNamespacePayload`, `DEFAULT_NAMESPACES`, `normaliseNamespaceEntry`, `stripNamespaceKinds`, `UnboundTables<C>`, the four `instanceof NamespaceBase` brand-check sites — S1.D.
- **Framework canonicalizer's SQL-specific paths** (L70–L167, L231–L273) — S1.D, when the family-contribution hook lands.
- **Population of `domain` plane** with `models` / `valueObjects` content — S1.C. S1.A only introduces the type slot.
- **Removing the framework-shared `storage.<ns>.types` slot** as a load-bearing surface — S1.B. S1.A leaves it in place; the descriptor's `storageSlotKey: 'postgresEnums'` registration is wiring for S1.B to consume.
- **Codec-id consolidation** (the two `PG_ENUM_CODEC_ID` constants) — non-binding spec-level cleanup; tolerated.
- **SQLite's `PostgresEnumStorageEntry` rejection-path imports** (three files) — Tier 3 cleanup explicitly deferred in spec § non-goals.
- **`storage.namespaces` → `storage.<ns>` direct-keying** — S1.B carries this change atomically with the enum migration.

## Approach

Two dispatches, sequential within this slice. Dispatch 1 ships the framework type primitives without behavioural change. Dispatch 2 wires the descriptor mechanism and the Postgres pack's `postgresEnums` registration through to validators and serializers, leaving the old enum-in-`types`-slot path operational. By the end of the slice the substrate is in place but no on-disk contract has shifted — the next slice (S1.B) is what consumes the new mechanism for real.

### Dispatch 1 — Framework primitives

Type-level additions on the framework `Contract`, `Namespace`, and `Storage` interfaces. The interface-narrowing of `Namespace` (`kind` becomes required) is the only behavioural surface this dispatch touches — concrete classes already declare `kind`, so the change is mechanical at the type level but exposes any consumer that was treating `kind` as optional. Implementation order:

1. Add `EntityCoordinate` type co-located with `Storage` in `framework-components/ir/storage.ts`. Export a free `elementCoordinates(storage): Generator<EntityCoordinate>` function from the same module. Internally dispatches on `Namespace.kind` via an inline `Map<namespaceKind, ReadonlyArray<{ slotKey, entityKind }>>` lookup table that hardcodes the two currently-shipping kinds (`'sql-namespace'` → `[tables, types]`; `'mongo-namespace'` → `[collections]`). D2 replaces the inline table with the pack-contributed descriptor registry. **The `Storage` interface stays unchanged** — no method added (see § "Why a free function" above for the rationale).
2. Promote `kind` from optional on `IRNode` to required on `Namespace`. Update `NamespaceBase` to require concrete declaration. The existing non-enumerable `Object.defineProperty(this, 'kind', { value: '…', enumerable: false })` pattern stays in concrete classes.
3. Add `domain` to the framework `Contract` type as an optional field with the shape `Record<string, Record<string, Record<string, unknown>>>`. The framework canonicalizer's `TOP_LEVEL_ORDER` learns the new key. No content is populated.

### Dispatch 2 — Descriptor mechanism + Postgres registration

Extend the descriptor; wire dispatch generically; register Postgres `postgresEnums` through it. Implementation order:

1. Extend `AuthoringEntityTypeDescriptor` with `storageSlotKey?`, `hydrate?`, `validatorSchema?`. None of the existing inference-load-bearing fields (`output.factory`'s contravariant `input: never`) move.
2. Add a framework-level descriptor-registry surface families consume — exact shape is an implementer-degree-of-freedom (a sidecar Map keyed by `(targetFamily, slotKey)`, or registry methods on the family base, or similar). Working position: extend the existing `SqlContractSerializerBase.entityTypeRegistry` Map's key shape to discriminate `storage.types` entries from pack-contributed slot entries.
3. SQL and Mongo family validators (`validators.ts` for SQL, `contract-schema.ts` for Mongo) learn to compose `validatorSchema` fragments into their per-namespace entry schemas at boot. The SQL validator's hardcoded `'types?': type({ '[string]': PostgresEnumTypeSchema })` block stays for now — the composition surface exists alongside it as a no-op until S1.B.
4. Postgres pack updates its `entityTypes.enum` descriptor with `storageSlotKey: 'postgresEnums'` + `hydrate` + `validatorSchema`. The descriptor's `hydrate` callback is identical to the existing `PostgresContractSerializer.hydrateSqlNamespaceEntry` enum branch — call sites in the serializer are refactored to delegate to the registry rather than handling enum hardcoded.

## Edge cases (Example-Mapping)

| Edge case | Disposition | Notes |
|---|---|---|
| `Namespace.kind` promotion from optional to required exposes consumers that treated it as optional | Handle | Type-system finds them at compile time. Any `namespace.kind ?? '…'` fallbacks must be removed (related to F2 in failure-modes — constructor magic for optional fields). |
| Existing non-enumerable `kind` via `Object.defineProperty` on `SqlNamespacePayload` / `MongoNamespacePayload` conflicts with required interface field | Handle | The non-enumerable pattern stays — interface requires presence, not enumerability. JSON serialization unchanged. Verified by a deserialize-round-trip test that doesn't expect `kind` in the JSON envelope. |
| `instanceof NamespaceBase` brand checks (4 call sites: `sql-storage.ts`, `sql-contract-serializer-base.ts`, `postgres-contract-serializer.ts`, `mongo-storage.ts`) | Handle | The interface narrowing is type-level only; `NamespaceBase` class identity is unchanged, so brand checks still discriminate. |
| `EntityCoordinate` ordering of fields | Handle | Working position per spec OQ4: object literal with stable field order `{ namespaceId, entityKind, entityName }`. Consumers should not depend on `Object.keys()` iteration order, but the canonical shape is fixed. |
| `elementCoordinates(storage)` iterator vs array | Handle | Working position per spec OQ4: `Generator<EntityCoordinate>` (free function via `function*` syntax) for laziness — consumers usually filter, large contracts shouldn't materialise. |
| `domain` plane introduced but unpopulated | Handle | Type-system allows; canonicalizer's `TOP_LEVEL_ORDER` includes it; downstream consumers (emitter, serializer) ignore an absent `domain` field. Verified by typecheck pass + existing fixture-shape parity. |
| Mongo family has no pack-contributed entity kinds today | Handle | Validator composition surface must be a no-op when no descriptor registers a `validatorSchema`. Test: an empty contributions registry leaves `MongoNamespaceEnvelopeSchema` byte-identical to today's compiled schema. |
| SQL family validator's hardcoded enum `types?` entry stays alongside the composition surface | Handle | This dispatch deliberately keeps the dual path — composition fragments + hardcoded enum schema both work. S1.B's job to drop the hardcoded path. Risk pre-named under failure-mode F1 (dual-shape relocated under new name) — to avoid that pattern, the composition surface is documented as "additive only, no replacement"; S1.B deletes the hardcoded path cleanly. |
| Descriptor's `hydrate?` callback delegated-to in serializer's enum branch, but the existing `entityTypeRegistry` constructor wiring stays | Handle | The Postgres serializer's `hydrateSqlNamespaceEntry` enum branch is refactored to call into the registry; the registry's lookup uses `(targetFamily, slotKey)` for pack-contributed kinds and `kind` for legacy `storage.types` entries. Mechanism extension, not replacement. |
| Family-pack `storageSlotKey` collides with framework's reserved slot names (`tables`, `collections`) | Handle | Add a validator that rejects pack-contributed `storageSlotKey` values matching the family's built-in slot names. Catches authoring bugs at descriptor-registration time. |
| `pnpm fixtures:check` byte-stability after the descriptor mechanism lands | Handle | No fixture should change in this slice. Verified by `pnpm fixtures:check` clean. If anything moves, the dispatch reverts the descriptor wiring (signal that the no-op path isn't no-op). |
| `deserializeContract<T>(json): T` cast site in the demo (PDoD7) | Defer | The interface generic exists; the demo cast is a JSON-typing ergonomics issue, not a substrate gap. Resolved when descriptor mechanism wires hydration end-to-end — most likely visible in S1.B / S1.C as cross-cutting fallout. Re-evaluated at S1.D. |
| `'postgres-schema'` `kind` set non-enumerably on namespace envelope by `PostgresContractSerializer.serializeContract` collides conceptually with new required `Namespace.kind` | Explicitly out | Two different `kind` fields at two different levels: the namespace-envelope `kind` (`'sql-namespace'` / `'mongo-namespace'` / `'postgres-schema'`) is the runtime brand the framework uses to dispatch; the new required `Namespace.kind` IS this same field promoted to required at the interface. No semantic change; the audit confirms they're the same field. |
| `DEFAULT_NAMESPACES` singleton injection in `SqlStorage` and `MongoStorage` constructors | Explicitly out | Spec marks for S1.D deletion. This slice leaves the injection in place; the new free `elementCoordinates(storage)` walk handles the default-namespace case via the slot-key lookup just like any other namespace. |
| `extractStorageElementNames` is still the migration-loader's walker | Explicitly out | Spec marks for S1.D replacement. Free `elementCoordinates(storage)` walk introduced now; replacement happens later. The two coexist in this slice. |
| `roots: Record<string, string>` (string-keyed model names) | Explicitly out | Spec marks for S1.C migration to object pairs. This slice doesn't touch `roots`. |

## Slice Definition of Done

- [ ] **SDoD1.** All "Done when" gates from the slice plan pass (CI green; lint clean; typecheck clean; fixtures unchanged). Specifically `pnpm typecheck`, `pnpm test:packages`, `pnpm lint:deps`, `pnpm fixtures:check`.
- [ ] **SDoD2.** Every pre-named edge case handled per its disposition.
- [ ] **SDoD3.** Reviewer verdict: accept on the slice's PR review (architect persona for the descriptor surface; principal-engineer persona for the type narrowing's call-site fallout).
- [ ] **SDoD4.** Manual-QA — **N/A**, rationale: no user-observable surface changes. Authoring DSL unchanged; emitted contract shape unchanged; no PSL grammar shift; no CLI behavior shift; demo apps build and run identically pre- and post-merge. If the demo's `as unknown as typeof contract` cast (PDoD7) becomes removable during the slice as fallout, that's a code-shape change, not a user-observable one — still N/A.
- [ ] **SDoD5.** Slice doesn't touch surfaces listed as out-of-scope. Specifically: no edits to `'postgres-enum'` literal sites; no edits to `extractStorageElementNames`; no edits to `roots` type; no deletion of `DEFAULT_NAMESPACES` or `normaliseNamespaceEntry` or `stripNamespaceKinds`. Verified by `git diff --stat` audit at slice-PR-open time.
- [ ] **SDoD6.** Substrate-hygiene grep gates clean per [`drive/calibration/grep-library.md` § IR substrate hygiene](../../../../drive/calibration/grep-library.md#ir-substrate-hygiene):
  - `rg 'namespaceId\?:' packages/` — zero new occurrences in this diff
  - `rg '\.namespaceId\s*\?\?' packages/` — zero new occurrences
  - `rg 'looksLikeFlat|normalizeStorageForHydration|stampNamespaceOnTable|normalizeStorageEnvelopeShape|isFlatTablesInput|isFlatTypesInput' packages/` — zero hits (catches F1 dual-shape relocation)

## Open Questions

These are implementer degrees of freedom; settle during dispatch execution per spec invariant I12 (new edge cases re-enter discussion mode, not silent handling).

1. **Where does `EntityCoordinate` live?** Same file as `Storage` interface, or sibling `entity-coordinate.ts`. Working position: **same file as `Storage`** — they're conceptually coupled; the file is small enough.
2. **Descriptor-registry shape for pack-contributed slots.** Extend `SqlContractSerializerBase.entityTypeRegistry` Map's key to a discriminated union `{ kind: 'storage-type'; key: string } | { kind: 'pack-slot'; family: string; slotKey: string }`? Or a parallel Map? Working position: **parallel Map** — keeps existing `storage.types` lookups intact; pack-slot lookups are a new path.
3. **`validatorSchema` composition order.** When multiple packs contribute to the same family's namespace schema, what's the merge order? Working position: **registration order** — deterministic, no special collision rules needed because `storageSlotKey` collisions are already caught by the validator added to the in-scope work.
4. **`elementCoordinates(storage)` over the SQL `types?` slot.** Should the walk's `'sql-namespace'` slot-key entry yield `(ns, 'types', name)` entries for the framework-shared `types` slot? **Settled in D1: yes** — `SLOT_KEYS_BY_NAMESPACE_KIND.get('sql-namespace')` returns `[{ slotKey: 'tables', entityKind: 'tables' }, { slotKey: 'types', entityKind: 'types' }]`. S1.B will remove the slot, at which point the `types` entry naturally drops out of the lookup. Alternative: only yield built-in family-slot entries; pack-contributed and `types` entries are filtered out. Rejected because consumers that need filtering can filter; consumers that need the entries can't synthesize them.
5. **`hydrate` callback signature: `(raw: unknown) => Output` vs `(raw: unknown, ctx: HydrationContext) => Output`.** Working position: **without context** — every existing hydrator works without one; introducing a context surface that has no consumers is premature generalisation. If a downstream pack needs context (e.g. for codec-id resolution), the descriptor's `hydrate` signature can be extended later as an additive change.

## Slice DoR

Per canonical [`docs/drive/principles/definition-of-ready.md`](../../../../docs/drive/principles/definition-of-ready.md) + [team overlay](../../../../drive/calibration/dor.md):

**Canonical:**

- [x] Slice spec exists — this file.
- [ ] **Slice plan exists** — handed off to `drive-plan-slice` after this spec is reviewed; will land at `projects/contract-ir-planes/slices/substrate/plan.md` with the two dispatches sized.
- [ ] **Every dispatch sized ≤ M** — verified at plan time; working position is two M dispatches (mechanical type changes + descriptor wiring), each within the M ceiling per [`drive/calibration/sizing.md`](../../../../drive/calibration/sizing.md).
- [x] Outcome fits in one PR — type-additive changes + descriptor surface + Postgres registration; ~18–20 files across the two dispatches per project plan estimate.
- [x] Calibration entries referenced — [`drive/calibration/failure-modes.md`](../../../../drive/calibration/failure-modes.md) F1 (dual-shape support relocated under new name) and F2 (constructor magic for optional fields) apply; both surfaced in the edge-case table. F4 (feature-sized dispatch without inspection cadence) applies to the plan-side sizing discipline. [`drive/calibration/grep-library.md`](../../../../drive/calibration/grep-library.md) § IR substrate hygiene entries map to SDoD6.
- [x] Spike dependencies resolved — none; the explore subagent's surface inventory (in chat transcript) is the substrate research; no spike needed.
- [x] Design calls settled — D1–D6 settled in spec; D8 settled (this slice ships substrate only, not affordances); OQ1/OQ3/OQ4/OQ5 working positions named above.
- [x] Slice serves parent project's purpose — every project PDoD reads from this slice's substrate.

**Team overlay** ([`drive/calibration/dor.md` § Slice-DoR overlay](../../../../drive/calibration/dor.md#slice-dor-overlay)):

- [x] Linear issue created and linked from the slice spec — parent ticket [TML-2584](https://linear.app/prisma-company/issue/TML-2584) is the project-level tracker; slice tickets are explicitly **not** created (team no-sub-issues rule; this slice's tracking is via on-disk `projects/contract-ir-planes/plan.md` § S1.A).
- [x] Slice's PR-to-be will carry `Refs: TML-2584` in the body — handled at PR open time via `drive-pr-description`.
- [x] Parent branch is `main` — this slice's branch (`tml-2584-s1a-substrate`) was cut off `origin/main` at commit `664a9aebb` (project's planning PR merge).
- [x] Slice plan references failure-mode entries — pre-flagged here (F1, F2, F4); plan will thread into each dispatch's edge-case table.
- [x] Slice plan references grep-library entries — pre-flagged here (IR substrate hygiene); plan will thread into each dispatch's DoD.

## References

- **Parent project:** [`projects/contract-ir-planes/spec.md`](../../spec.md) §§ D1, D2, D3, D5, D6, D8; FR1, FR2, FR4, FR5, FR7; A1, A7
- **Parent plan:** [`projects/contract-ir-planes/plan.md`](../../plan.md) § S1.A — Substrate
- **Umbrella plan:** [`projects/target-extensible-ir-namespaces/plan.md`](../../../target-extensible-ir-namespaces/plan.md)
- **Linear:** [TML-2584](https://linear.app/prisma-company/issue/TML-2584) (sub-project tracker; no slice-level ticket per no-sub-issues rule)
- **ADR:** [`projects/contract-ir-planes/adrs/0001-contract-planes.md`](../../adrs/0001-contract-planes.md) D1–D6
- **Calibration:**
  - [`drive/calibration/failure-modes.md`](../../../../drive/calibration/failure-modes.md) F1, F2, F4
  - [`drive/calibration/grep-library.md`](../../../../drive/calibration/grep-library.md) § IR substrate hygiene
  - [`drive/calibration/sizing.md`](../../../../drive/calibration/sizing.md) — dispatch M-cap reference
- **Surface inventory** for the affected files (gathered via `explore` subagent 2026-05-20; not committed): 10 surface groups inventoried with current shapes + call-site counts. Available in this slice's chat transcript.
