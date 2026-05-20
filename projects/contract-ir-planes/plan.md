# Project Plan: contract-ir-planes

**Spec:** [`projects/contract-ir-planes/spec.md`](./spec.md)
**ADR:** [`projects/contract-ir-planes/adrs/0001-contract-planes.md`](./adrs/0001-contract-planes.md)
**Linear Project:** [Target-Extensible IR + Namespaces](https://linear.app/prisma-company/project/target-extensible-ir-namespaces-fd69eff8aec6) (this is one sub-project; tracking ticket [TML-2584](https://linear.app/prisma-company/issue/TML-2584))

**Purpose** _(from spec)_: Make the contract IR target-extensible at the entity-kind level — target packs contribute new entity kinds through a single framework-level mechanism with a uniform IR shape every consumer can walk by entity coordinate. Without this restructure, every new pack-contributed kind would hardcode itself into the framework the way Postgres enum currently does; the substrate this project builds is what makes the rest of the umbrella ship.

## At a glance

Four slices. The PDoD3 bar (enum out of framework-shared `types` slot; pack contributes its own kind) is satisfied at the end of S1.B. Each slice ships as one PR per drive's slice = PR coupling; multi-step internal work decomposes into dispatches within the slice rather than into sibling slices.

## Composition

### Stack (deliver in order)

#### S1.A — Substrate: two-plane IR primitives + entity coordinate + pack-contributed entity-kind mechanism

**Purpose.** Lay down the framework-level substrate every other slice consumes: framework type primitives for the two-plane shape, entity-coordinate addressing primitive, and the pack-contributed entity-kind descriptor mechanism. Postgres pack registers `postgresEnums` slot through the new descriptor — wiring is in place, but the existing `storage.<ns>.types` slot still carries enum entries (no migration yet; S1.B does that).

**Why one slice (not two).** A previous draft of this plan split substrate into "framework primitives" + "descriptor mechanism wiring" as separate slices. The primitives have no consumer until the descriptor wiring lands — *"no behavioural change yet because nothing consumes the new shape"* is the co-ship falsifier from `drive/retro/findings.md` (2026-05-20 entry). Collapsed to one slice with two dispatches.

**Dispatches (within this slice):**

1. **D1 — Framework primitives.** `domain` plane added to framework `Contract` type. Framework `Namespace` interface narrowed to `{ id, kind }`. Family-specific slots (`tables`, `collections`) move to family-shaped namespace types. `Storage.elementCoordinates()` polymorphic walk introduced. Callers updated to consume the narrowed interface (the only behavioural surface this dispatch touches).
2. **D2 — Descriptor mechanism + Postgres pack registration.** `AuthoringContributions.entityTypes` descriptor shape extended to carry storage-slot key + serializer hydration factory + validator schema fragment alongside the existing IR-class factory. Framework canonicalizer / serializer / validator dispatch through the descriptor registry generically. Postgres pack registers `postgresEnums` slot via the new descriptor. Old `storage.<ns>.types` slot remains writable; no on-disk contract changes.

**Scope.** ~18-20 files total across the two dispatches. No on-disk contract changes.

**Depends on.** Nothing (foundation slice).

**Linear:** [TML-2622](https://linear.app/prisma-company/issue/TML-2622).

**Validation gate:**

- `pnpm typecheck`
- `pnpm test:packages`
- `pnpm lint:deps`

#### S1.B — Enum migration off framework-shared types slot (PDoD3 satisfied)

**Purpose.** Cut the load-bearing migration that proves the substrate works. Postgres enum moves from `storage.<ns>.types` (framework-shared) to `storage.<ns>.postgresEnums` (Postgres-pack-contributed). The framework-shared `storage.<ns>.types` slot is deleted as a load-bearing surface. Fixtures carrying enum entries regenerate atomically within this same PR — fixture regen is a forced consequence of the slot change, not a separate sliceable step.

**Working assumption on slot transition.** Spec OQ2 names this as an implementer degree of freedom with working position **hard-cut** (assumes A6: no external consumers pinning the shape). If A6 holds when execution starts, this slice executes as a single hard-cut. If A6 is falsified, the slice splits into 3a (deprecation shim) + 3b (hard-cut) — discussion-mode re-entry trigger.

**Dispatches (within this slice):**

1. **D1 — IR + validator + verifier + emitter codegen.** `SqlStorage` slot typing drops `PostgresEnumStorageEntry` from the framework-shared `types` slot; SQL family validator drops `PostgresEnumTypeSchema` from `NamespaceEntrySchema`; SQL family verifier's `verifyEnumType` becomes descriptor-driven; emitter codegen's `kind: 'postgres-enum'` literal emission consumes the descriptor; family base's *'postgres-enum requires PostgresContractSerializer'* error goes generic. SQLite's `PostgresEnumStorageEntry` imports stay (Tier 3 deferred per spec § non-goals).
2. **D2 — Regenerate enum-bearing fixtures.** Run `pnpm fixtures:emit` against the 4 contract.json files audit-confirmed to carry `storage.<ns>.types.<enum>` (per spec § audit-summary reference). Update their .d.ts. Verify migration replay against the 6 pre-#534 bookend contracts that carry document-scoped enums (A4 falsification check).
3. **D3 — Grep-gate verification.** `rg "PostgresEnumStorageEntry|'postgres-enum'" packages/1-framework/ packages/2-sql/9-family/` returns zero matches. Surface confirmation in the PR body.

**Scope.** ~15 source files (D1) + ~10 contract.{json,d.ts} files (D2). One PR.

**Depends on.** S1.A.

**Linear:** [TML-2623](https://linear.app/prisma-company/issue/TML-2623).

**Validation gate:**

- `pnpm typecheck`
- `pnpm test:packages`
- `pnpm test:integration`
- `pnpm fixtures:check`
- `pnpm lint:deps`
- **Project-specific:** PDoD3 grep gate (see D3 above)

#### S1.C — Cross-reference encoding migration (object pairs)

**Purpose.** `relation.to`, `model.base`, `roots[*]` change from `"ModelName"` to `{ namespace, model }` everywhere. Authoring DSL takes entity handles (user-facing API unchanged); emitter, serializer, deserializer, validator handle the new on-the-wire encoding. The `domain` plane (introduced as types in S1.A) gets populated by the authoring layer. Fixtures carrying cross-references regenerate atomically.

**Dispatches (within this slice):**

1. **D1 — Encoding migration in framework + authoring + emitter + serializer + validator.** Touch the encoding at every site that reads / writes it. Authoring layer (`contract-ts`, `contract-psl`) takes handles unchanged but emits object pairs.
2. **D2 — Regenerate cross-reference-bearing fixtures.** Run `pnpm fixtures:emit`; goldens shift wherever a contract has at least one cross-namespace reference (most contracts). Mechanical; the diff is largely uniform.

**Scope.** ~10-12 source files (D1) + ~15-25 contract.{json,d.ts} files (D2). One PR.

**Depends on.** S1.B (consumes the descriptor mechanism + new IR shape).

**Linear:** [TML-2624](https://linear.app/prisma-company/issue/TML-2624).

**Validation gate:**

- `pnpm typecheck`
- `pnpm test:packages`
- `pnpm test:integration`
- `pnpm fixtures:check`
- `pnpm test:e2e`
- `pnpm lint:deps`

#### S1.D — Delete subsumed surfaces + close subsumed Linear tickets

**Purpose.** Reap the cleanup. Delete `findSqlTable`, `assertUniqueSqlTableNames`, `extractStorageElementNames`, `SqlNamespacePayload`, `DEFAULT_NAMESPACES`, `normaliseNamespaceEntry`, `stripNamespaceKinds`, `UnboundTables<C>`. Replace remaining call sites with `Storage.elementCoordinates()` walks. Framework canonicalizer's SQL-specific paths replaced with the family-contribution hook. Subsumed Linear tickets ([TML-2579](https://linear.app/prisma-company/issue/TML-2579), [TML-2580](https://linear.app/prisma-company/issue/TML-2580), [TML-2582](https://linear.app/prisma-company/issue/TML-2582), and the three other subsumed tickets per § Project-DoD coverage map) marked Done via PR-merge GitHub integration when this slice's PR lands referencing the ticket identifiers.

**Why a separate slice from the others.** Reviewers can focus on deletion correctness without conflating with structural changes. The deletions are also a quantitative signal — the grep gate is a separate PDoD check that doesn't belong inside a structural slice.

**Dispatches (within this slice):**

1. **D1 — Deletions.** Remove the eight subsumed surfaces.
2. **D2 — Call-site updates.** Replace remaining callers with `Storage.elementCoordinates()` walks; framework canonicalizer's SQL-specific paths replaced with the family-contribution hook.
3. **D3 — Grep-gate verification.** `rg "findSqlTable|assertUniqueSqlTableNames|extractStorageElementNames|SqlNamespacePayload|DEFAULT_NAMESPACES|normaliseNamespaceEntry|stripNamespaceKinds|UnboundTables<C>"` in `packages/` and `examples/` returns zero matches.
4. **D4 — Linear close-out references.** PR body references TML-2579, TML-2580, TML-2582, TML-2545, TML-2563, TML-2586 by identifier so GitHub integration auto-transitions them to the team's completed state on merge.

**Scope.** ~5-8 source files (D1+D2). One PR.

**Depends on.** S1.C (the new surface needs to be working everywhere before old shims come out).

**Linear:** [TML-2625](https://linear.app/prisma-company/issue/TML-2625).

**Validation gate:**

- `pnpm typecheck`
- `pnpm test:packages`
- `pnpm test:integration`
- `pnpm test:e2e`
- `pnpm fixtures:check`
- `pnpm lint:deps`
- **Project-specific:** PDoD5 grep gate (see D3 above)

### Parallel groups

None. Single stack thread S1.A → S1.B → S1.C → S1.D.

Each slice's substrate is required by the next. The "could S1.B and S1.C parallelise?" question fails the validation-gate test — both regenerate fixtures, and the goldens churn would conflict at merge time if they raced.

## Dependencies (external)

- [x] **PR #534 merged.** Required base; landed at commit `66da80f96`.
- [ ] **EA timeline confirmed.** Pre-EA must-ship status of this sub-project depends on umbrella-level sequencing; see [`projects/target-extensible-ir-namespaces/plan.md`](../target-extensible-ir-namespaces/plan.md).
- [x] **Linear tickets for S1.A through S1.D.** Created 2026-05-20: TML-2622 (S1.A), TML-2623 (S1.B), TML-2624 (S1.C), TML-2625 (S1.D). All four `relatedTo` TML-2584 (graph link without sub-issue hierarchy per the team's no-sub-issues rule).

## Project-DoD coverage map

| Project-DoD | Delivered by |
|---|---|
| **PDoD1.** All slices delivered or deferred | All 4 slices |
| **PDoD2.** All in-tree contracts follow canonical shape | S1.B (enum-shape regen) + S1.C (cross-ref regen) |
| **PDoD3.** Postgres enum at `storage.<ns>.postgresEnums`; framework no longer references `'postgres-enum'` | S1.B (grep gate enforces) |
| **PDoD4.** Cross-namespace references use object pairs | S1.C |
| **PDoD5.** Framework `Namespace` narrowed; subsumed helpers deleted | S1.A (narrowing) + S1.D (deletions, grep gate enforces) |
| **PDoD6.** `Storage.elementCoordinates()` consumed by planner/migration/validators | S1.A (introduces) + S1.D (consumed by retired sites' replacements) |
| **PDoD7.** `deserializeContract<T>(json): T` generic | S1.A (descriptor mechanism includes serializer hydration) |
| **PDoD8.** Validation gates clean | Each slice's gate + final retro gate |
| **PDoD9.** ADR migrated to `docs/architecture docs/adrs/` | Close-out task |
| **PDoD10.** Subsumed tickets closed | S1.D's PR body links the six subsumed tickets |
| **PDoD11.** `projects/contract-ir-planes/` deleted, references stripped | Close-out task |

## Risks + open questions

1. **A4 falsification — pre-#534 bookend handling.** 6 migration bookend `end-contract.json` files carry the old document-scoped enum shape (`storage.types.<X>` rather than `storage.namespaces.<ns>.types.<X>`). If migration-replay rejects them in S1.B's D2 verification step, S1.B absorbs a bookend regeneration as an extra dispatch — adds maybe 0.5 days. If it cascades further (replay path itself needs refactoring), promote that into its own slice and re-sequence. Discussion-mode re-entry trigger.
2. **A6 falsification — external consumers pinning hash or shape.** Working position is hard-cut (S1.B deletes the old slot immediately). If EA users surface during execution who depend on the old shape, S1.B splits into deprecation-shim + hard-cut sub-slices, adding maybe 2 days and re-sequencing S1.C/D timing. Discussion-mode re-entry trigger.
3. **A7 falsification — canonicalizer family-contribution hook circular dependency.** The framework canonicalizer cleanup (subsumed TML-2579) introduces a hook the family packs implement. If the hook design needs framework to import family code, the cleanup pattern doesn't work and S1.D's scope shrinks (TML-2579 stays open as a separate followup). Discussion-mode re-entry trigger.
4. **OQ resolutions before S1.A starts.** OQ1 (slot key naming), OQ3 (`EntityKindDescriptor` extends or parallel), OQ4 (`elementCoordinates()` return shape), OQ5 (validator-schema contribution mechanism) all resolve at the start of S1.A. None are project-purpose-affecting; implementer picks the working position unless a structural reason emerges.

## Sequencing visualisation

```text
S1.A (substrate — 2 dispatches inside)
  ↓
S1.B (enum migration off types slot — 3 dispatches inside)  ← PDoD3 satisfied here
  ↓
S1.C (cross-reference encoding — 2 dispatches inside)
  ↓
S1.D (cleanup + Linear close-outs — 4 dispatches inside)
```

Realistic budget: **~2-3 days per slice × 4 = ~10-12 days** for the sub-project. S1.A's two dispatches likely compress (mechanical class shape changes); S1.B is the largest and most likely to spawn unforeseen sub-work (A4 / A6 falsification triggers); S1.D mechanical.

## Close-out (required)

- [ ] Verify all PDoDs in [`projects/contract-ir-planes/spec.md`](./spec.md)
- [ ] Mandatory final retro complete; output landed in canonical / project-context / ADR
- [ ] Migrate [`adrs/0001-contract-planes.md`](./adrs/0001-contract-planes.md) into `docs/architecture docs/adrs/`
- [ ] Strip repo-wide references to `projects/contract-ir-planes/**` (replace with canonical `docs/` links or remove)
- [ ] Delete `projects/contract-ir-planes/`
- [ ] Linear Project marked Completed (auto via PR-merge integration; tickets reference `TML-2584` in PR titles/bodies)
