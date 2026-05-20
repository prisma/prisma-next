# Brief: D1 — Framework type primitives (S1.A)

> **R2 redirect (2026-05-20):** the original R1 brief promoted `elementCoordinates()` to a required member of the `Storage` interface. That broke structural assignability of emitted `contract.d.ts` literals against `Contract<SqlStorage>` consumers (because the printed storage literal carries `storageHash` / `namespaces` / `types?` but no method members), surfacing as a ~29-fixture cascade and a `pnpm fixtures:check` byte-stability violation. R2 reframes the walk as a **free function** consuming any `Storage`-shaped value, dispatched on `Namespace.kind` via an inline lookup table. The interface stays unchanged; emitted literals keep satisfying every consumer; fixtures stay byte-stable. R1 partial work in the worktree (8 unstaged files) is **reverted in step 0 below** before the new edits start.

## Outcome

Land three additive type changes + one targeted interface narrowing + one free helper on the framework type substrate, with **no on-disk contract changes** and **byte-stable fixtures**:

1. **`EntityCoordinate` type** (`{ namespaceId: string; entityKind: string; entityName: string }`) in `@prisma-next/framework-components/ir` — co-located with `Storage` per slice-spec OQ1 working position.
2. **Free `elementCoordinates(storage)` helper** in `@prisma-next/framework-components/ir` — yields `Generator<EntityCoordinate>` over any value structurally matching the framework `Storage` interface. Internally consults an inline `Map<namespaceKind, ReadonlyArray<{ slotKey, entityKind }>>` lookup table to know which slot keys to walk per `ns.kind`. The lookup table hardcodes the two currently-shipping kinds: `'sql-namespace'` → `[{ slotKey: 'tables', entityKind: 'tables' }, { slotKey: 'types', entityKind: 'types' }]`, and `'mongo-namespace'` → `[{ slotKey: 'collections', entityKind: 'collections' }]`. D2 replaces the inline table with the pack-contributed descriptor registry; this dispatch only ships the substrate.
3. **`Contract.domain?` field** added to the framework `Contract` type as `Record<string, Record<string, Record<string, unknown>>>`; framework canonicalizer's `TOP_LEVEL_ORDER` learns the new key (the plane stays empty in every emitted contract this dispatch — S1.C migrates the content).
4. **`Namespace.kind` interface narrowing** — promoted from optional on `IRNode` (where it stays optional) to **required on `Namespace`**. Concrete `NamespaceBase` subclasses change their `declare readonly kind?: string` to `declare readonly kind: string` (the runtime non-enumerable `Object.defineProperty(this, 'kind', { value: '…', enumerable: false })` pattern stays intact — interface requires presence, not enumerability).

End-state: framework type substrate is in place; no consumer touches the new helper yet (D2 wires the descriptor consumers); zero fixture drift; zero on-disk contract changes.

## Scope

### Step 0 — Revert R1's interface-on-Storage attempt (8 unstaged files in the worktree)

Run `git diff --stat` first to confirm the working set matches the list below. Then revert each file to `HEAD`:

```bash
git restore packages/1-framework/0-foundation/contract/src/canonicalization.ts
git restore packages/1-framework/0-foundation/contract/src/contract-types.ts
git restore packages/1-framework/1-core/framework-components/src/exports/ir.ts
git restore packages/1-framework/1-core/framework-components/src/ir/storage.ts
git restore packages/2-mongo-family/1-foundation/mongo-contract/src/ir/mongo-storage.ts
git restore packages/2-sql/1-core/contract/src/ir/sql-storage.ts
git restore packages/2-sql/2-authoring/contract-ts/src/contract-types.ts
git restore packages/2-sql/5-runtime/test/context.types.test-d.ts
```

After revert, `git diff --stat` must show zero unstaged changes. Confirm with `pnpm typecheck` on `packages/1-framework/1-core/framework-components/` — must be clean before any new edits start. **Do not** run `git clean -f*`, `git reset --hard`, or any other destructive command (F5 in calibration: forbidden without orchestrator approval).

### Step 1 — Add `EntityCoordinate` + free `elementCoordinates` helper

File: **`packages/1-framework/1-core/framework-components/src/ir/storage.ts`**

Add (above the existing `Storage` interface):

```ts
export interface EntityCoordinate {
  readonly namespaceId: string;
  readonly entityKind: string;
  readonly entityName: string;
}

const SLOT_KEYS_BY_NAMESPACE_KIND = new Map<
  string,
  ReadonlyArray<{ readonly slotKey: string; readonly entityKind: string }>
>([
  [
    'sql-namespace',
    [
      { slotKey: 'tables', entityKind: 'tables' },
      { slotKey: 'types', entityKind: 'types' },
    ],
  ],
  ['mongo-namespace', [{ slotKey: 'collections', entityKind: 'collections' }]],
]);

/**
 * Lazy walk over every named storage entity in a `Storage`-shaped
 * value, yielded as `(namespaceId, entityKind, entityName)` triples.
 *
 * Dispatch is keyed on each namespace's `kind` literal. The slot-key
 * table below is hardcoded for the two namespace kinds shipping
 * today (`'sql-namespace'`, `'mongo-namespace'`); the
 * pack-contributed descriptor registry replaces this lookup once it
 * lands. Unrecognised `kind` values throw with a diagnostic naming
 * the namespace id and the offending kind — silent skipping would
 * hide drift from the future verifier consumer.
 */
export function* elementCoordinates(storage: Storage): Generator<EntityCoordinate> {
  for (const [namespaceId, ns] of Object.entries(storage.namespaces)) {
    const slotKeys = SLOT_KEYS_BY_NAMESPACE_KIND.get(ns.kind);
    if (slotKeys === undefined) {
      throw new Error(
        `elementCoordinates(): unrecognised namespace kind ${JSON.stringify(ns.kind)} ` +
          `on namespace ${JSON.stringify(namespaceId)}. ` +
          `Add a slot-key entry to SLOT_KEYS_BY_NAMESPACE_KIND, ` +
          `or wait for the pack-contributed descriptor registry (D2).`,
      );
    }
    for (const { slotKey, entityKind } of slotKeys) {
      const slot = (ns as Readonly<Record<string, unknown>>)[slotKey];
      if (slot !== undefined && slot !== null && typeof slot === 'object') {
        for (const entityName of Object.keys(slot)) {
          yield { namespaceId, entityKind, entityName };
        }
      }
    }
  }
}
```

The single `as Readonly<Record<string, unknown>>` cast is justified because the descriptor table promises slot-key validity for the looked-up `kind`; narrowing further would require importing family-specific `Namespace` subtypes into the framework layer.

**Do not** add any member to the `Storage` interface. Leave the interface signature unchanged.

### Step 2 — Wire the export

File: **`packages/1-framework/1-core/framework-components/src/exports/ir.ts`**

Add `EntityCoordinate` to the type re-exports and add `elementCoordinates` to the value re-exports from `'../ir/storage'`. After the edit, the file's storage line should read:

```ts
export type { EntityCoordinate, Storage } from '../ir/storage';
export { elementCoordinates } from '../ir/storage';
```

### Step 3 — Add `Contract.domain?` field

File: **`packages/1-framework/0-foundation/contract/src/contract-types.ts`**

Add `readonly domain?` to the `Contract<TStorage, TModels>` interface between `valueObjects?` and `storage`. Use the docstring as written in the reverted R1 diff (see git log of the reverted file for verbatim text — it described the `<plane>[ns][kind][name]` shape and the byte-stability promise). Final field shape:

```ts
readonly domain?: Record<string, Record<string, Record<string, unknown>>>;
```

### Step 4 — Extend canonicalizer `TOP_LEVEL_ORDER`

File: **`packages/1-framework/0-foundation/contract/src/canonicalization.ts`**

Add `'domain'` to the `TOP_LEVEL_ORDER` array. Place between `'valueObjects'` and `'storage'` to match the `Contract` interface field order. **Do not** touch the SQL-specific `storage.namespaces.*` path checks elsewhere in the file (those belong to S1.B / S1.D).

After the edit, run `pnpm fixtures:check` — must be byte-stable (no fixture writes `domain`, so the array entry stays inert).

### Step 5 — Narrow `Namespace.kind` to required

File: **`packages/1-framework/1-core/framework-components/src/ir/namespace.ts`**

Promote `kind` to required on the `Namespace` interface (today: inherited optional from `IRNode`). Tighten `NamespaceBase` (abstract class) so subclasses must declare `kind` concretely. **Do not** touch `IRNode.kind?` in `packages/1-framework/1-core/framework-components/src/ir/ir-node.ts` — it stays optional at the IRNode level; the narrowing is `Namespace`-only.

### Step 6 — Update concrete namespace classes (4 files)

For each of the four namespace-payload classes, flip `declare readonly kind?: string` → `declare readonly kind: string`. The runtime `Object.defineProperty(this, 'kind', { value: '…', enumerable: false })` block stays untouched — the type-side change requires presence, the runtime continues to bind a non-enumerable property (so JSON serialisation is byte-identical).

- `packages/2-sql/1-core/contract/src/ir/sql-storage.ts:51` — `SqlNamespacePayload`
- `packages/2-sql/1-core/contract/src/ir/sql-unbound-namespace.ts:43` — `SqlUnboundNamespace`
- `packages/2-mongo-family/1-foundation/mongo-contract/src/ir/mongo-storage.ts:29` — `MongoNamespacePayload`
- `packages/2-mongo-family/1-foundation/mongo-contract/src/ir/mongo-unbound-namespace.ts:13` — `MongoUnboundNamespace`

### Step 7 — Tighten `BuiltStorage<Definition>` namespace-literal `kind`

File: **`packages/2-sql/2-authoring/contract-ts/src/contract-types.ts`** (lines 567, 574)

Flip `readonly kind?: string` → `readonly kind: string` on both namespace shapes inside `BuiltStorage<Definition>`. Emitted `contract.d.ts` files already carry literal `readonly kind: 'sql-namespace'`, which still satisfies the narrowed type. `contractTs(...).emit()` builder must also always produce a `kind`; verify with `pnpm test:packages -- contract-ts` after the edit.

### Step 8 — Clean up the Mongo-emitter fallback

File: **`packages/2-mongo-family/3-tooling/emitter/src/index.ts:56`**

Replace `(ns as { kind?: string }).kind ?? 'mongo-namespace'` with `ns.kind` (typed as `string` now). Re-import or adjust types as needed so the line typechecks without the cast. This is the cure for F2 (constructor magic for optional fields) in the Namespace position — **do not** preserve the `?? '…'` fallback in any form.

### Step 9 — Audit-only cascade sites (no edits expected)

Run before invoking `pnpm typecheck`:

```bash
# Confirm no further `?? '…'` fallbacks against ns.kind exist
rg '\b(namespace|ns)\.kind\s*\?\?' packages/ -g '!*.test*'
# Expect: zero hits

# Confirm no other `declare readonly kind?` on a NamespaceBase subclass
rg 'declare readonly kind\?' packages/ -g '!*.test*'
# Expect: zero hits after step 6

# Confirm BuiltStorage is the only authoring-side type literal touched
rg 'readonly kind\?:' packages/2-sql/2-authoring/ packages/2-mongo-family/ -g '!*.test*'
# Expect: zero hits in BuiltStorage; any other hit is out of scope
```

Defensive casts of the form `(ns as { kind?: unknown }).kind === '…'` in:
- `packages/2-sql/3-tooling/emitter/src/index.ts:421,429`
- `packages/3-targets/3-targets/postgres/src/core/postgres-schema.ts:189`

…remain typechecking after the narrowing (the cast widens, then the equality check narrows again). **Leave them alone** — touching them widens the diff beyond D1's scope; their cleanup is a follow-up if at all.

### Out of scope (this dispatch)

- Moving enum entries off `storage.<ns>.types` slot — S1.B
- Cross-reference encoding migration (`relation.to`, `model.base`, `roots[*]` from string to object pairs) — S1.C
- Deletion of subsumed surfaces (`findSqlTable`, `assertUniqueSqlTableNames`, `extractStorageElementNames`, `DEFAULT_NAMESPACES`, `normaliseNamespaceEntry`, `stripNamespaceKinds`, `UnboundTables<C>`, the private `SqlNamespacePayload` / `MongoNamespacePayload` classes) — S1.D
- Framework canonicalizer's SQL-specific path checks (L70–L167, L231–L273) — S1.D
- Removing the framework-shared `storage.<ns>.types` slot — S1.B
- SQLite's `PostgresEnumStorageEntry` rejection-path imports — Tier 3 deferred
- Codec-id consolidation (the two `PG_ENUM_CODEC_ID` constants) — non-binding cleanup
- Population of the `domain` plane with `models` / `valueObjects` content — S1.C
- Wiring any consumer to call `elementCoordinates(storage)` — D2 / S1.D
- Replacing the inline `SLOT_KEYS_BY_NAMESPACE_KIND` lookup with the descriptor registry — D2
- Any modification of the `Storage` interface beyond `EntityCoordinate` type co-location

## Edge cases (from slice spec § Edge cases — D1's portion, re-baselined for the free-function approach)

| Edge case | Disposition |
|---|---|
| Emitted `contract.d.ts` literals must keep satisfying `Contract<SqlStorage>` / `Contract<MongoStorage>` consumers. | **Handled by design.** The free function consumes `Storage`-shaped values; no interface method added. The emitted literal's storage shape is unchanged. **Verified by `pnpm typecheck` workspace-wide.** |
| `Namespace.kind` promotion from optional to required. | **Handled by Steps 5–9.** Cascade is bounded (4 class declarations + 1 emitter fallback + 1 BuiltStorage type). Pre-enumerate with the grep gates in Step 9 BEFORE running `pnpm typecheck` (F3 anti-pattern: do not discover via test suite). Do not introduce new `?? '…'` fallbacks — re-introducing them re-creates F2 in the Namespace position. |
| Non-enumerable `kind` via `Object.defineProperty` on the four namespace-payload classes. | **Handled by Step 6.** The runtime pattern stays. The change is type-only: interface requires presence; the non-enumerable runtime property satisfies presence. JSON serialisation unchanged → `fixtures:check` byte-stability holds. |
| `instanceof NamespaceBase` brand checks (4 audited sites: `sql-storage.ts`, `sql-contract-serializer-base.ts`, `postgres-contract-serializer.ts`, `mongo-storage.ts`). | **Handled by typecheck.** Interface narrowing doesn't change class identity. Brand checks continue to discriminate. **Verified by `pnpm typecheck` + `pnpm test:packages`.** |
| `EntityCoordinate` field ordering. | **Handled by Step 1.** Working position per slice-spec OQ4: `{ namespaceId, entityKind, entityName }`. The shape is fixed; consumers should not depend on `Object.keys()` iteration order. |
| `elementCoordinates()` iterator vs array. | **Handled by Step 1.** Working position: `Generator<EntityCoordinate>` for laziness. Use `function*` syntax. |
| `domain` plane introduced but unpopulated. | **Handled by Steps 3, 4.** Type-system allows absence; canonicalizer's `TOP_LEVEL_ORDER` includes it; downstream emitter / serializer ignore an absent field. **Verified by `pnpm typecheck` + `pnpm fixtures:check` byte-stability.** |
| Unrecognised `ns.kind` at walk time. | **Handled by Step 1.** Walk throws with a clear diagnostic naming the namespace id + offending kind. Silent skipping would hide drift from D2's descriptor-registry consumers. Since no caller is wired in this dispatch, the throw is theoretical here. |
| Postgres-serializer-emitted JSON envelope `kind: 'postgres-schema'` / `'postgres-unbound-schema'` (set in `packages/3-targets/3-targets/postgres/src/core/postgres-contract-serializer.ts:96,140`) vs hydrated instance's runtime `kind: 'sql-namespace'`. | **Explicitly out per spec.** Two separate concerns: the JSON envelope kind is a serialisation tag the postgres serializer writes; the hydrated runtime instance is `SqlNamespacePayload` with `kind = 'sql-namespace'`. The free walk consumes hydrated `Storage`, so it sees `'sql-namespace'` and looks it up correctly. No change needed in this dispatch. |
| `DEFAULT_NAMESPACES` singleton injection in `SqlStorage` / `MongoStorage` constructors. | **Explicitly out per spec.** S1.D handles deletion. `elementCoordinates(storage)` walks the default namespace just like any other — no special-casing here. |
| `extractStorageElementNames` migration-loader walker stays. | **Explicitly out per spec.** S1.D replaces callers with `elementCoordinates(storage)` walks. Two coexist in this dispatch (and through the whole slice). |
| `roots: Record<string, string>` (string-keyed model names). | **Explicitly out per spec.** S1.C migrates to object pairs. Do not touch. |
| Destructive git operations (`git clean -f*`, `git reset --hard`, `git stash drop`, `git stash clear`, `git checkout -- .`, `rm -rf` against the worktree). | **Forbidden without orchestrator approval** per failure-mode F5 in `drive/calibration/failure-modes.md`. Reference incident: 2026-05-17 setup cleanup deleted ~1500 lines of in-flight methodology project docs. |

## Done when

- [ ] `pnpm typecheck` clean across the workspace — narrowing fully propagated; zero new `?? '…'` fallbacks against `ns.kind` introduced
- [ ] `pnpm test:packages` green — runtime behaviour unchanged; non-enumerable `kind` pattern still produces JSON without `kind` on namespace envelopes
- [ ] `pnpm lint:deps` clean — no new layering violations
- [ ] `pnpm fixtures:check` clean — **byte-stability gate; this dispatch must produce zero fixture drift.** Any drift means a type-only change leaked into runtime behaviour; investigate, do not commit.
- [ ] `pnpm build` of affected downstream packages clean: `packages/2-sql/1-core/contract`, `packages/2-mongo-family/1-foundation/mongo-contract`, `packages/2-sql/9-family`, `packages/3-targets/3-targets/postgres`, `packages/2-sql/2-authoring/contract-ts`, `packages/2-mongo-family/3-tooling/emitter`
- [ ] **Intent-validation**: `git diff --stat` shows ≤ 12 files in `packages/`; **zero edits** to `'postgres-enum'` literal sites (`rg "'postgres-enum'" packages/` count unchanged); **zero edits** to `extractStorageElementNames`; **zero edits** to `roots` type; **zero edits** to `DEFAULT_NAMESPACES`, `normaliseNamespaceEntry`, `stripNamespaceKinds`, `UnboundTables<C>`; **zero new members on `Storage` interface** (only `EntityCoordinate` type and `elementCoordinates` free function added to the same file)
- [ ] Grep gates per [`drive/calibration/grep-library.md` § IR substrate hygiene](../../../../../drive/calibration/grep-library.md#ir-substrate-hygiene):
  - `rg 'namespaceId\?:' packages/` — zero new occurrences (count before and after)
  - `rg '\.namespaceId\s*\?\?' packages/` — zero new occurrences
  - `rg '\.kind\s*\?\?' packages/ -g '!*.test*'` — count must DECREASE by 1 (the mongo-emitter fallback removed in Step 8) and no new occurrences elsewhere
  - `rg 'looksLikeFlat|normalizeStorageForHydration|stampNamespaceOnTable|normalizeStorageEnvelopeShape|isFlatTablesInput|isFlatTypesInput' packages/` — zero hits (F1 dual-shape relocation check)
  - `rg 'declare readonly kind\?' packages/ -g '!*.test*'` — zero hits after Step 6
- [ ] All commits explicitly staged (`git add <specific-paths>` only; never `git add -A` / `git add .`)
- [ ] Per-commit messages reference D1, the slice spec path (`projects/contract-ir-planes/slices/substrate/spec.md`), and TML-2584
- [ ] Heartbeats written to `wip/heartbeats/implementer.txt` per the cadence in `<skill-dir>/agents/implementer.md § Heartbeats`

## Size + time-box

- **T-shirt:** M (post-redirect — the work is now strictly mechanical revert + free function + bounded narrowing cascade)
- **Wall-clock:** ≤ 90 min
- **Hard escalation trigger:** halt and return to orchestrator if any of the following fire:
  - typecheck cascade after Steps 5–9 exceeds 15 modified files in `packages/`
  - `pnpm fixtures:check` shows any drift
  - any step requires modifying a file not enumerated in Steps 0–8
  - any new `?? '…'` fallback against `ns.kind` is required to satisfy typecheck
  - the `Storage` interface needs anything beyond co-locating `EntityCoordinate`

## Model tier

**Composer-2.5** (slug: `composer-2.5-fast`). Per orchestrator routing rule (2026-05-20): aim for Composer-2.5 on all implementation work; reserve Opus 4.7 for dispatches with creative latitude or unknowns. This dispatch is now strictly bounded:

- Every file is enumerated by path.
- Every edit is described literally (verbatim type signatures, exact lookup-table contents, exact field placement).
- The narrowing cascade was pre-enumerated by orchestrator grep (4 class declarations + 1 emitter fallback + 1 BuiltStorage line).
- The free-function approach removes the family-extensibility design judgment that motivated Opus on the prior brief.
- Hard escalation triggers above bound the dispatch — anything outside the enumerated edits returns control to the orchestrator before Composer-2.5 has to make a design call.

If any escalation trigger fires, the orchestrator re-dispatches the residual on Opus 4.7 (`claude-opus-4-7-thinking-high`).

## Inputs

- **Slice spec:** [`projects/contract-ir-planes/slices/substrate/spec.md`](../spec.md) — read in full before starting
- **Slice plan:** [`projects/contract-ir-planes/slices/substrate/plan.md`](../plan.md) — read § Dispatch 1
- **Parent project spec:** [`projects/contract-ir-planes/spec.md`](../../../spec.md) §§ D1, D2, D5, D6; FR1, FR2, FR4; A1
- **Parent ADR:** [`projects/contract-ir-planes/adrs/0001-contract-planes.md`](../../../adrs/0001-contract-planes.md) D1, D2, D3
- **Prior-round pushback log (R1 → R2 redirect rationale):** R1's interface-promotion attempt broke `Contract<SqlStorage>` structural assignability for 29 emitted `contract.d.ts` files (one error per consumption site → ~56 typecheck diagnostics). Root cause: emitted storage literals are printed as raw object types (no method members); adding a required method to `Storage` broke `SqlStorage`'s structural shape; emitted literals stopped matching. Redirect: walk lives as a free function consuming `Storage`-shaped values — no method on the interface, no structural mismatch.
- **Calibration:**
  - [`drive/calibration/failure-modes.md`](../../../../../drive/calibration/failure-modes.md) — F2 (constructor magic for optional fields — directly relevant to Step 8), F3 (discovery via test suite — anti-pattern to avoid; pre-enumerate via grep), F4 (feature-sized dispatch — sizing discipline), F5 (destructive git — forbidden without approval)
  - [`drive/calibration/grep-library.md`](../../../../../drive/calibration/grep-library.md) — § IR substrate hygiene
  - [`drive/calibration/sizing.md`](../../../../../drive/calibration/sizing.md) — M anchor
  - [`drive/calibration/dod.md`](../../../../../drive/calibration/dod.md) — dispatch-DoD validation gates
- **Branch:** `tml-2584-s1a-substrate` (off `origin/main`)

## Implementer + Reviewer

- **Implementer:** subagent (this dispatch), model `composer-2.5-fast`. R2 round (R1 halted; reverting and redirecting per pushback).
- **Reviewer:** subagent, model `claude-opus-4-7-thinking-high`. Delegated after D1 DoD passes.
