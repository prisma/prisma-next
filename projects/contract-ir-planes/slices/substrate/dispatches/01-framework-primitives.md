# Brief: D1 — Framework type primitives (S1.A)

## Outcome

Land three additive type changes + one targeted interface narrowing on the framework type substrate, with **no on-disk contract changes** and **byte-stable fixtures**:

1. New `EntityCoordinate` type (`{ namespaceId: string; entityKind: string; entityName: string }`) + `Storage.elementCoordinates(): Generator<EntityCoordinate>` method on the framework `Storage` interface; implementations on `SqlStorage` (yielding `(ns, 'tables', tableName)` per table; also yield `(ns, 'types', name)` entries for the current framework-shared `types` slot per slice-spec OQ4 working position) and `MongoStorage` (yielding `(ns, 'collections', collectionName)` per collection).
2. Optional `domain` field added to the framework `Contract` type as `domain?: Record<string, Record<string, Record<string, unknown>>>`; framework canonicalizer's `TOP_LEVEL_ORDER` array learns the new key (added in a position that produces stable canonical output for contracts that don't carry it).
3. `Namespace` interface narrowed: `kind` promoted from optional on `IRNode` to required on `Namespace`. The change ripples to `NamespaceBase` (abstract class requires concrete declaration) and to each concrete payload's `declare readonly kind?: string` → `declare readonly kind: string` (the runtime `Object.defineProperty(this, 'kind', { value: '…', enumerable: false })` pattern stays intact — interface requires presence, not enumerability).

Single dispatch; single commit (or a small commit train if the kind narrowing reads cleaner as its own commit). End-state: framework type substrate is in place; no consumer touches the new types yet (D2 wires the descriptor consumers).

## Scope

**In scope** (files to edit):

- `packages/1-framework/0-foundation/contract/src/contract-types.ts` — add optional `domain?` field to `Contract<TStorage, TModels>` interface
- `packages/1-framework/0-foundation/contract/src/canonicalization.ts` — extend `TOP_LEVEL_ORDER` (currently L17–L31) with `domain`. Do NOT touch the SQL-specific `storage.namespaces.*` path checks at L70–L167, L231–L273 — those belong to S1.B (slot move) and S1.D (family-contribution hook)
- `packages/1-framework/1-core/framework-components/src/ir/namespace.ts` — narrow `Namespace` interface so `kind: string` is required (today: inherited optional `kind?: string` from `IRNode`); tighten `NamespaceBase` to require concrete declaration
- `packages/1-framework/1-core/framework-components/src/ir/ir-node.ts` — **NO change** to `IRNode.kind?` (keep optional at the IRNode level; only `Namespace` narrows). Audit only — confirm no IRNode consumer breaks.
- `packages/1-framework/1-core/framework-components/src/ir/storage.ts` — add `EntityCoordinate` type and `Storage.elementCoordinates()` signature (co-located per slice-spec OQ1 working position)
- `packages/2-sql/1-core/contract/src/ir/sql-storage.ts` — implement `SqlStorage.elementCoordinates()`; update `SqlNamespacePayload` and `SqlUnboundNamespace` singleton's `declare readonly kind?: string` → required
- `packages/2-mongo-family/1-foundation/mongo-contract/src/ir/mongo-storage.ts` — implement `MongoStorage.elementCoordinates()`; update `MongoNamespacePayload` and `MongoUnboundNamespace` singleton's `kind` declaration
- `packages/3-targets/3-targets/postgres/src/core/postgres-schema.ts` (if `PostgresSchema` shadows `Namespace.kind`) — verify; tighten declaration if needed. Per the explore inventory, `PostgresSchema.kind = 'schema'` — verify whether this is the same field as `Namespace.kind` or a separate property
- Brand-check sites (4 files audited; verify `instanceof NamespaceBase` still discriminates after the interface narrowing — pure type-system change, no runtime impact expected): `packages/2-sql/1-core/contract/src/ir/sql-storage.ts`, `packages/2-sql/9-family/src/core/ir/sql-contract-serializer-base.ts`, `packages/3-targets/3-targets/postgres/src/core/postgres-contract-serializer.ts`, `packages/2-mongo-family/1-foundation/mongo-contract/src/ir/mongo-storage.ts`
- Any other call sites the `Namespace.kind` narrowing's typecheck cascade surfaces. Use `rg 'namespace\.kind' packages/` + `rg '\.kind\s*\?\?' packages/` to enumerate **before** running typecheck (per the F3 anti-pattern in calibration: don't discover via test-suite runs)

**Out of scope (this dispatch):**

- **Moving enum entries off `storage.<ns>.types` slot** — D2's not-quite-territory; the actual migration is S1.B (slice TML-2623). The descriptor mechanism's `postgresEnums` slot registration happens in D2.
- **Cross-reference encoding migration** (`relation.to`, `model.base`, `roots[*]` from string to object pairs) — S1.C (TML-2624)
- **Deletion of subsumed surfaces** — `findSqlTable`, `assertUniqueSqlTableNames`, `extractStorageElementNames`, `SqlNamespacePayload` (the private class can be public-typed but stays as-is structurally), `DEFAULT_NAMESPACES`, `normaliseNamespaceEntry`, `stripNamespaceKinds`, `UnboundTables<C>` — S1.D
- **Framework canonicalizer's SQL-specific path checks** (L70–L167, L231–L273) — S1.D
- **Removing the framework-shared `storage.<ns>.types` slot** — S1.B
- **SQLite's `PostgresEnumStorageEntry` rejection-path imports** (3 files: `sqlite/src/core/migrations/{issue-planner,planner-ddl-builders,planner-strategies}.ts`) — Tier 3 deferred per spec
- **Codec-id consolidation** (the two `PG_ENUM_CODEC_ID` constants in `postgres-enum-type.ts` private + `codec-ids.ts` public) — non-binding spec-level cleanup
- **Population of `domain` plane** with `models` / `valueObjects` content — S1.C (this dispatch adds the TYPE only; the plane stays empty in every emitted contract)

## Edge cases (from slice spec § Edge cases — D1's portion)

| Edge case | Disposition |
|---|---|
| `Namespace.kind` promotion from optional to required exposes consumers that treated it as optional. | **Handle.** Use `rg 'namespace\.kind' packages/` and `rg '\.kind\s*\?\?' packages/` BEFORE running typecheck to enumerate sites (F3 anti-pattern in calibration). Update each site explicitly; do not introduce `?? '…'` fallbacks (the change is the *cure* for F2 in the Namespace position — re-introducing a fallback re-creates the failure mode). |
| Existing non-enumerable `kind` via `Object.defineProperty` on `SqlNamespacePayload` / `MongoNamespacePayload` conflicts with required interface field. | **Handle.** The non-enumerable runtime pattern stays. The change is type-only: `declare readonly kind?: string` → `declare readonly kind: string` on the class. JSON serialisation unchanged (the field is non-enumerable, so it doesn't appear in JSON envelopes). Verified by `fixtures:check` byte-stability + a deserialize-round-trip test. |
| `instanceof NamespaceBase` brand checks (4 audited sites). | **Handle.** Type narrowing is interface-level only; `NamespaceBase` class identity is unchanged. Brand checks continue to discriminate. Verify with `pnpm typecheck` + `pnpm test:packages`. |
| `EntityCoordinate` field ordering. | **Handle.** Working position per slice-spec OQ4: `{ namespaceId, entityKind, entityName }` in that order. Consumers should not depend on `Object.keys()` iteration order, but the canonical shape is fixed. |
| `Storage.elementCoordinates()` iterator vs array. | **Handle.** Working position: `Generator<EntityCoordinate>` for laziness. Use `function*` generator syntax. Consumers usually filter. |
| `domain` plane introduced but unpopulated. | **Handle.** Type-system allows; canonicalizer's `TOP_LEVEL_ORDER` includes it; downstream consumers (emitter, serializer) ignore an absent `domain` field. Verified by `pnpm typecheck` + `pnpm fixtures:check` byte-stable. |
| `'postgres-schema'` `kind` set non-enumerably on namespace envelope by `PostgresContractSerializer.serializeContract` collides conceptually with new required `Namespace.kind`. | **Explicitly out per spec.** Same field at the same level, just promoted to required at the interface. The audit confirms they're the same field — no semantic change. |
| `DEFAULT_NAMESPACES` singleton injection in `SqlStorage` / `MongoStorage` constructors. | **Explicitly out per spec.** S1.D handles deletion. `elementCoordinates()` walks the default namespace just like any other — no special-casing here. |
| `extractStorageElementNames` migration-loader walker stays. | **Explicitly out per spec.** S1.D replaces callers with `elementCoordinates()` walks. Two coexist in this dispatch (and through the whole slice). |
| `roots: Record<string, string>` (string-keyed model names). | **Explicitly out per spec.** S1.C migrates to object pairs. Do not touch. |
| Destructive git operations (`git clean -f*`, `git reset --hard`, `git stash drop`, `git stash clear`, `git checkout -- .`, `rm -rf` against the worktree). | **Forbidden without orchestrator approval** per failure-mode F5 in `drive/calibration/failure-modes.md`. Reference incident: 2026-05-17 setup cleanup deleted ~1500 lines of in-flight methodology project docs. |

## Done when

- [ ] `pnpm typecheck` clean across the workspace — narrowing fully propagated; any consumer reading `Namespace.kind` as optional updated
- [ ] `pnpm test:packages` green — runtime behaviour unchanged
- [ ] `pnpm lint:deps` clean — no new layering violations
- [ ] `pnpm fixtures:check` clean — **byte-stability gate; this dispatch must produce zero fixture drift**. Any drift means the type-only change leaked into runtime behaviour; investigate, do not commit.
- [ ] `pnpm build` of affected downstream packages clean: `packages/2-sql/1-core/contract`, `packages/2-mongo-family/1-foundation/mongo-contract`, `packages/2-sql/9-family`, `packages/3-targets/3-targets/postgres` (needed because `packages/1-framework/1-core/framework-components` is upstream of all of them)
- [ ] **Intent-validation**: `git diff --stat` shows ≤ ~12 files in `packages/`; **zero edits** to `'postgres-enum'` literal sites (`rg "'postgres-enum'" packages/` count unchanged); **zero edits** to `extractStorageElementNames`; **zero edits** to `roots` type; **zero edits** to `DEFAULT_NAMESPACES`, `normaliseNamespaceEntry`, `stripNamespaceKinds`, `UnboundTables<C>`
- [ ] Grep gates per [`drive/calibration/grep-library.md` § IR substrate hygiene](../../../../../drive/calibration/grep-library.md#ir-substrate-hygiene):
  - `rg 'namespaceId\?:' packages/` — zero new occurrences in this diff (count before and after)
  - `rg '\.namespaceId\s*\?\?' packages/` — zero new occurrences
  - `rg '\.kind\s*\?\?' packages/` — zero new occurrences (F2-territory check specific to this dispatch)
  - `rg 'looksLikeFlat|normalizeStorageForHydration|stampNamespaceOnTable|normalizeStorageEnvelopeShape|isFlatTablesInput|isFlatTypesInput' packages/` — zero hits (F1 dual-shape relocation check)
- [ ] All commits explicitly staged (`git add <specific-paths>` only; never `git add -A` / `git add .`)
- [ ] Per-commit messages reference D1, the slice spec path, and TML-2584
- [ ] Heartbeats written to `wip/heartbeats/implementer.txt` per the cadence in `<skill-dir>/agents/implementer.md § Heartbeats`

## Size + time-box

- **T-shirt:** M
- **Wall-clock:** ≤ 2 hr (per [`drive/calibration/sizing.md`](../../../../../drive/calibration/sizing.md) M anchor; 2-4 files anchor stretched here to ~10-12 because the narrowing cascade is bounded but real)
- **Re-decomposition trigger:** if the typecheck cascade exceeds 30 modified files OR the dispatch passes 90 min wall-clock without nearing done, halt and surface to the orchestrator. Likely re-decomposition: D1a (additive types only) + D1b (kind narrowing + cascade) + D1c (Contract.domain + canonicalizer)

## Model tier

Opus (orchestrator-class). Substrate change per [`drive/calibration/model-tier.md`](../../../../../drive/calibration/model-tier.md) row 1: *"Substrate change / design judgment / spec interpretation"*. Slug: `claude-opus-4-7-thinking-high`.

**Why not cheaper:** the `Namespace.kind` narrowing requires understanding which consumers were defensively reading `kind` as optional and shouldn't reintroduce fallbacks. The `EntityCoordinate` + `elementCoordinates()` introduction is type-design work. Both fit the "substrate / spec interpretation" routing rule.

## Inputs

- **Slice spec:** [`projects/contract-ir-planes/slices/substrate/spec.md`](../spec.md) — read in full before starting
- **Slice plan:** [`projects/contract-ir-planes/slices/substrate/plan.md`](../plan.md) — read § Dispatch 1
- **Parent project spec:** [`projects/contract-ir-planes/spec.md`](../../../spec.md) §§ D1, D2, D5, D6; FR1, FR2, FR4; A1
- **Parent ADR:** [`projects/contract-ir-planes/adrs/0001-contract-planes.md`](../../../adrs/0001-contract-planes.md) D1, D2, D3
- **Calibration:**
  - [`drive/calibration/failure-modes.md`](../../../../../drive/calibration/failure-modes.md) — F2 (constructor magic for optional fields — directly relevant), F3 (discovery via test suite — anti-pattern to avoid), F4 (feature-sized dispatch — sizing discipline), F5 (destructive git — forbidden without approval)
  - [`drive/calibration/grep-library.md`](../../../../../drive/calibration/grep-library.md) — § IR substrate hygiene
  - [`drive/calibration/sizing.md`](../../../../../drive/calibration/sizing.md) — M anchor
  - [`drive/calibration/dod.md`](../../../../../drive/calibration/dod.md) — dispatch-DoD validation gates
- **Branch:** `tml-2584-s1a-substrate` (off `origin/main`)

## Implementer + Reviewer

- **Implementer:** subagent (this dispatch), model `claude-opus-4-7-thinking-high`. First round; no prior subagent ID to resume.
- **Reviewer:** subagent, model `claude-opus-4-7-thinking-high`. Delegated after D1 DoD passes (next step in the loop).
