# Project Plan: contract-ir-planes

**Spec:** [`projects/contract-ir-planes/spec.md`](./spec.md)
**ADR:** [`projects/contract-ir-planes/adrs/0001-contract-planes.md`](./adrs/0001-contract-planes.md)
**Linear Project:** [Target-Extensible IR + Namespaces](https://linear.app/prisma-company/project/target-extensible-ir-namespaces-fd69eff8aec6) (this is one sub-project; tracking ticket [TML-2584](https://linear.app/prisma-company/issue/TML-2584))

**Purpose** _(from spec)_: Make the contract IR target-extensible at the entity-kind level — target packs contribute new entity kinds through a single framework-level mechanism with a uniform IR shape every consumer can walk by entity coordinate. Without this restructure, every new pack-contributed kind would hardcode itself into the framework the way Postgres enum currently does; the substrate this project builds is what makes the rest of the umbrella ship.

## At a glance

Six slices, three phases: **substrate** (framework primitives + descriptor mechanism), **migration** (Postgres enum off the framework-shared `types` slot), **propagation** (cross-references + on-disk regen + cleanup). The PDoD3 bar (enum out of framework-shared `types` slot; pack contributes its own kind) is satisfied at the end of Slice 3 — the migration slice. Slices 4–6 propagate the same structural decision to the rest of the IR and reap the cleanup tickets the reshape subsumes.

## Composition

### Stack (deliver in order)

#### Slice 1 — Two-plane IR shape primitives + entity-coordinate primitive

**Purpose.** Lay down the framework-level types every other slice consumes: `domain` plane on the framework `Contract`, narrowed framework `Namespace` interface (`{ id, kind }`), `Storage.elementCoordinates()` polymorphic walk, family namespace types (`SqlNamespace = Namespace & { tables, … }`, `MongoNamespace = Namespace & { collections, … }`).

**Scope.** ~10-12 files in `packages/1-framework/**`. No consumer migration; no fixtures change; no `contract.json` change.

**Depends on.** Nothing (foundation slice).

**Linear:** TBD — needs new ticket created against `Target-Extensible IR + Namespaces` project. Plan-author candidate title: *"S1.1 — Two-plane IR primitives + entity coordinate"*.

**Validation gate:**

- `pnpm typecheck`
- `pnpm test:packages` (framework-only test surfaces; the family-shaped types compile-check downstream)
- `pnpm lint:deps`

#### Slice 2 — Pack-contributed entity-kind descriptor mechanism

**Purpose.** Extend `AuthoringContributions.entityTypes` descriptor shape to carry storage-slot key + serializer hydration factory + validator schema fragment (alongside the existing IR-class factory). Wire framework canonicalizer / serializer / validator to dispatch through the descriptor registry generically. Postgres pack registers a `postgresEnums` slot via the new descriptor — the wiring is in place even though the existing `storage.<ns>.types` slot still carries enum entries (no migration yet).

**Scope.** ~8-10 files: descriptor type extension, dispatch wiring in framework serializer / canonicalizer / validator assemblers, Postgres pack contribution registration. No on-disk contract changes.

**Depends on.** Slice 1 (framework primitives).

**Linear:** TBD — *"S1.2 — Pack-contributed entity-kind descriptor mechanism"*.

**Validation gate:**

- `pnpm typecheck`
- `pnpm test:packages`
- `pnpm lint:deps`

#### Slice 3 — Migrate Postgres enum off framework-shared `types` slot (PDoD3 satisfied)

**Purpose.** Cut the load-bearing migration: `SqlStorage` slot typing drops `PostgresEnumStorageEntry` from the framework-shared `types` slot; SQL family validator drops `PostgresEnumTypeSchema` from `NamespaceEntrySchema`; SQL family verifier's `verifyEnumType` becomes descriptor-driven; emitter codegen's `kind: 'postgres-enum'` literal emission consumes the descriptor. Family base's `'postgres-enum requires PostgresContractSerializer'` error message goes generic. **SQLite `PostgresEnumStorageEntry` imports stay** (Tier 3 deferred per spec § D8 / non-goals).

**Scope.** ~12-15 files across `packages/2-sql/**` + `packages/2-sql/3-tooling/emitter/**` + `packages/3-targets/3-targets/postgres/**`. No on-disk JSON shape change yet — TypeScript types narrow, but emitted contract shape is the same as Slice 2 (slot is `storage.<ns>.postgresEnums` but enum entries still live under `storage.<ns>.types` as a compat shim during this slice's window).

Actually — re-reading my own framing: this slice needs to decide between two sub-shapes:

- **3a.** Add the new slot, leave the old one writable in parallel for one release (deprecation shim). Slice 5 then turns off the old slot.
- **3b.** Hard-cut: new slot only; on-disk contracts regenerate in this same slice; old slot deleted from `SqlStorage` immediately.

The spec's OQ2 names this as an implementer degree of freedom with working position **hard-cut** (assumes A6: no external consumers pinning the shape). If A6 holds when execution starts, Slice 3 is the hard-cut. If A6 is falsified, Slice 3 splits into 3a + 3b.

**Working assumption for this plan: hard-cut.** If that holds, Slice 3 absorbs the on-disk regen for the 4 contract.json files that currently carry `storage.<ns>.types.<enum>` (per audit § 7). Slice 5 (below) handles the rest of the universe (the cross-reference changes + cleanup of remaining stale shapes).

**Depends on.** Slice 1 + Slice 2.

**Linear:** TBD — *"S1.3 — Migrate Postgres enum off framework-shared types slot"*.

**Validation gate:**

- `pnpm typecheck`
- `pnpm test:packages`
- `pnpm test:integration` (the emitter / contract-shape integration tests are the load-bearing signal here)
- `pnpm fixtures:check`
- `pnpm lint:deps`
- **Project-specific grep gate:** `rg "PostgresEnumStorageEntry|'postgres-enum'" packages/1-framework/ packages/2-sql/9-family/` returns zero matches (PDoD3 quantitative check)

### Parallel group A (after stack)

Slices 4 and 5 land in either order or simultaneously. Both consume Slice 3's output.

#### Slice 4 — Cross-reference encoding migration

**Purpose.** `relation.to`, `model.base`, `roots[*]` change from `"ModelName"` to `{ namespace, model }` everywhere. Authoring DSL takes entity handles (user-facing API unchanged); emitter, serializer, deserializer, validator handle the new on-the-wire encoding. The `domain` plane (introduced as types in Slice 1) gets populated by the authoring layer.

**Scope.** ~8-10 files across emitter, contract-ts authoring, contract-psl authoring, validators, DSL accessor types.

**Depends on.** Slice 3 (consumes the descriptor mechanism + new shape).

**Linear:** TBD — *"S1.4 — Cross-reference encoding (object pairs)"*.

**Validation gate:**

- `pnpm typecheck`
- `pnpm test:packages`
- `pnpm test:integration`
- `pnpm fixtures:check`
- `pnpm lint:deps`

#### Slice 5 — On-disk contract regeneration + migration replay verification

**Purpose.** Run `pnpm fixtures:emit` against all in-tree contracts. Regenerate `examples/*/src/prisma/contract.{json,d.ts}`. Regenerate `test/fixtures/**`. Verify migration replay against pre-#534 bookend contracts (6 files with old document-scoped enum shape — A4 falsification check). Update demo apps' generated artifacts. Confirm `examples/prisma-next-cloudflare-worker/src/prisma/contract.json` regenerates clean.

**Scope.** ~10 `contract.json` + ~10 `contract.d.ts` files + migration bookend handling per A4 verification outcome. Mechanical work; any structural changes that surface during regen are A4 falsifications and trigger discussion-mode re-entry.

**Depends on.** Slice 3 (new shape).

**Linear:** TBD — *"S1.5 — On-disk contract regeneration + migration replay"*.

**Validation gate:**

- `pnpm fixtures:check` (universal — every fixture matches its regenerated golden)
- `pnpm test:integration` (migration-replay path)
- `pnpm test:e2e`
- `pnpm typecheck`

### Stack (after group A)

#### Slice 6 — Delete subsumed surfaces + close subsumed tickets

**Purpose.** Reap the cleanup. Delete `findSqlTable`, `assertUniqueSqlTableNames`, `extractStorageElementNames`, `SqlNamespacePayload`, `DEFAULT_NAMESPACES`, `normaliseNamespaceEntry`, `stripNamespaceKinds`, `UnboundTables<C>`. Replace remaining call sites with `Storage.elementCoordinates()` walks. Framework canonicalizer's SQL-specific paths replaced with the family-contribution hook. Subsumed Linear tickets ([TML-2579](https://linear.app/prisma-company/issue/TML-2579), [TML-2580](https://linear.app/prisma-company/issue/TML-2580), [TML-2582](https://linear.app/prisma-company/issue/TML-2582)) marked Done via PR-merge link in this slice's PR body.

**Scope.** ~5-8 files: deletions + a few callers updated to consume the new surface. Mechanical.

**Depends on.** Slices 4 + 5 (the new surface needs to be working everywhere before old shims can come out).

**Linear:** TBD — *"S1.6 — Delete subsumed surfaces + cleanup"*.

**Validation gate:**

- `pnpm typecheck`
- `pnpm test:packages`
- `pnpm test:integration`
- `pnpm test:e2e`
- `pnpm fixtures:check`
- `pnpm lint:deps`
- **Project-specific grep gate:** `rg "findSqlTable|assertUniqueSqlTableNames|extractStorageElementNames|SqlNamespacePayload|DEFAULT_NAMESPACES|normaliseNamespaceEntry|stripNamespaceKinds|UnboundTables<C>"` in `packages/` and `examples/` returns zero matches

## Dependencies (external)

- [x] **PR #534 merged.** Required base; landed at commit `66da80f96`.
- [ ] **EA timeline confirmed.** Pre-EA must-ship status of this sub-project depends on umbrella-level sequencing; check `projects/target-extensible-ir-namespaces/plan.md` (to be drafted) for the binding window.
- [ ] **Linear tickets for Slices 1-6.** Six tickets need creating under the existing Linear project before slice pickup begins. Plan-author decision: create as part of Linear audit pass, before the first slice ships.

## Project-DoD coverage map

| Project-DoD | Delivered by |
|---|---|
| **PDoD1.** All slices delivered or deferred | All 6 slices |
| **PDoD2.** All in-tree contracts follow canonical shape | Slice 5 |
| **PDoD3.** Postgres enum at `storage.<ns>.postgresEnums`; framework no longer references `'postgres-enum'` | Slice 3 (grep gate enforces) |
| **PDoD4.** Cross-namespace references use object pairs | Slice 4 |
| **PDoD5.** Framework `Namespace` narrowed; subsumed helpers deleted | Slice 1 (narrowing) + Slice 6 (deletions) |
| **PDoD6.** `Storage.elementCoordinates()` consumed by planner/migration/validators | Slice 1 (introduces) + Slice 6 (consumed by retired sites' replacements) |
| **PDoD7.** `deserializeContract<T>(json): T` generic | Slice 2 (descriptor mechanism includes serializer hydration) |
| **PDoD8.** Validation gates clean | Each slice's gate + final retro gate |
| **PDoD9.** ADR migrated to `docs/architecture docs/adrs/` | Close-out task |
| **PDoD10.** Subsumed tickets closed | Slice 6's PR body links the three tickets |
| **PDoD11.** `projects/contract-ir-planes/` deleted, references stripped | Close-out task |

## Risks + open questions

1. **A4 falsification — pre-#534 bookend handling.** 6 migration bookend `end-contract.json` files carry the old document-scoped enum shape (`storage.types.<X>` rather than `storage.namespaces.<ns>.types.<X>`). If migration-replay rejects them after Slice 3, Slice 5 absorbs a bookend regeneration pass — adds maybe 0.5 days. If it cascades further (replay path itself needs refactoring), promote that into its own slice and re-sequence. Discussion-mode re-entry trigger.
2. **A6 falsification — external consumers pinning hash or shape.** Working position is hard-cut (Slice 3 deletes the old slot immediately). If EA users surface during execution who depend on the old shape, Slice 3 splits into 3a (deprecation shim) + 3b (hard-cut, deferred to a later release). Adds maybe 2 days; re-sequences Slice 5 timing. Discussion-mode re-entry trigger.
3. **A7 falsification — canonicalizer family-contribution hook circular dependency.** The framework canonicalizer cleanup (subsumed TML-2579) introduces a hook the family packs implement. If the hook design needs framework to import family code, the cleanup pattern doesn't work and the canonicalizer cleanup gets reduced scope. Discussion-mode re-entry trigger.
4. **Parallel-group bandwidth.** Slices 4 and 5 are parallelisable in the plan; whether they actually parallelise depends on operator bandwidth. If one operator is driving alone, sequentialize naturally (Slice 4 → Slice 5 → Slice 6).
5. **OQ resolutions before Slice 1 starts.** OQ1 (slot key naming), OQ3 (`EntityKindDescriptor` extends or parallel), OQ4 (`elementCoordinates()` return shape), OQ5 (validator-schema contribution mechanism) all resolve at the start of Slice 1 or Slice 2. None are project-purpose-affecting (per spec § Open Questions); implementer picks the working position unless a structural reason emerges to do otherwise.

## Sequencing visualisation

```text
Slice 1 (primitives)
  ↓
Slice 2 (descriptor mechanism)
  ↓
Slice 3 (enum migration off types slot)  ← PDoD3 satisfied here
  ↓
  ┌── Slice 4 (cross-refs)         ── parallel ──
  └── Slice 5 (on-disk regen)      ── parallel ──
       ↓
Slice 6 (cleanup + Linear close-outs)
```

Realistic budget: **2 days per slice on average × 6 = ~10-12 days** for the sub-project. Slices 1+2 likely compress (mechanical class shape changes); Slice 3 most likely to spawn unforeseen sub-work; Slice 5 mechanical if A4 holds.

## Close-out (required)

- [ ] Verify all PDoDs in [`projects/contract-ir-planes/spec.md`](./spec.md)
- [ ] Mandatory final retro complete; output landed in canonical / project-context / ADR
- [ ] Migrate [`adrs/0001-contract-planes.md`](./adrs/0001-contract-planes.md) into `docs/architecture docs/adrs/`
- [ ] Strip repo-wide references to `projects/contract-ir-planes/**` (replace with canonical `docs/` links or remove)
- [ ] Delete `projects/contract-ir-planes/`
- [ ] Linear Project marked Completed (auto via PR-merge integration; tickets reference `TML-2584` in PR titles/bodies)
