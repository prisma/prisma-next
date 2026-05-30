# Project Plan: target-extensible-ir-namespaces

**Spec:** [`projects/target-extensible-ir-namespaces/spec.md`](./spec.md)
**Linear Project:** [Target-Extensible IR + Namespaces](https://linear.app/prisma-company/project/target-extensible-ir-namespaces-fd69eff8aec6)
**Purpose** _(from spec)_: Make first-class namespaces and target-extensible IR usable for the downstream Supabase integration. The contract IR reaches its canonical two-plane shape; runtime SQL and the DSL/ORM surfaces qualify identifiers and dispatch through a default-namespace fallback so existing single-namespace consumers experience zero breakage; the explicit namespace-aware surface (`db.sql.auth.user`) lands later as purely additive work.

## At a glance

Single sequential stack. S1 closed and proved the IR substrate (durable decisions in [ADR 221](../../docs/architecture%20docs/adrs/ADR%20221%20-%20Contract%20IR%20two%20planes%20with%20uniform%20entity%20coordinate%20and%20pack-contributed%20entity%20kinds.md)), but it shipped the storage plane under a `namespaces` wrapper and never wired the `domain` plane — so the emitted IR doesn't yet match ADR 221's prose. The remaining work is one re-planned-from-scratch thread:

```text
S2 — IR canonicalization (GAP 1 → GAP 2)   →   S3 — Postgres public-by-default   →   S4 — runtime qualification   →   S5 — explicit-namespace DSL (deferrable)
```

We do **not** split this into parallel projects: the only real concurrency is GAP 2 vs the rest, and it isn't enough independent work to justify a second project, worktree, Linear project, and the cross-project merge-order bookkeeping. GAP 1 and S4 touch the same identifier-emission paths, so the IR-shape fix must land first regardless. One worktree + branch per slice; new slice tickets created at pickup, not all upfront.

## Composition

### Stack (deliver in order)

#### S1 — contract IR planes + pack-contributed entity-kind mechanism + Postgres enum migration

**Unit type:** Sub-project (multi-slice; **closed** — durable decisions in [ADR 221](../../docs/architecture%20docs/adrs/ADR%20221%20-%20Contract%20IR%20two%20planes%20with%20uniform%20entity%20coordinate%20and%20pack-contributed%20entity%20kinds.md)).

**Purpose.** Restructure the contract IR around two planes (`domain`, `storage`) with uniform `<plane>.<ns>.<entityKind>.<entityName>` indexing and canonical entity coordinates. Add the pack-contributed entity-kind descriptor mechanism. Migrate Postgres enum off the framework-shared `types` slot as the substrate's load-bearing exemplar.

**Outcome.** Delivered across five merged slices. Proved the two-plane model and the pack-contributed entity-kind mechanism (Postgres enum). **What it did not finish:** the emitted storage plane still carries a `storage.namespaces.<ns>` wrapper, and the `domain` plane was never wired (models/valueObjects/types remain flat at the contract root). S2 closes that gap.

**Linear:** [TML-2584](https://linear.app/prisma-company/issue/TML-2584) (Done).

**Priority.** Closed.

#### S2 — IR canonicalization to the ADR-221 shape

**Unit type:** Sub-project (two slices — GAP 1 then GAP 2).

**Purpose.** Bring the emitted IR to the canonical shape ADR 221 describes. This is S1's unfinished FR2, pulled forward as its own focused work.

- **GAP 1 — drop the `storage.namespaces` wrapper.** Storage is indexed directly as `storage.<nsId>.<entityKind>.<entityName>` (no `namespaces` segment). Touches the framework `Storage` IR type + `elementCoordinates` walk, SQL-family `SqlStorage`, serializer/deserializer hydration + validators, canonicalization + emitter, and every on-disk `contract.json` / `contract.d.ts` (storageHash churn). **Picked up now.** Linear [TML-2747](https://linear.app/prisma-company/issue/TML-2747).
- **GAP 2 — wire the `domain` plane.** Flat `contract.models` / `contract.valueObjects` / `contract.types` move under `contract.domain.<ns>.{models, valueObjects, types}`. Pure IR-shape correctness — does **not** affect runtime SQL qualification. Likely ~2 dispatches (type + emitter, then consumer migration). Linear ticket created at pickup.

**Depends on.** S1 (closed).

**Validation gate (per slice PR).**

- `pnpm typecheck` · `pnpm test:packages` · `pnpm test:integration` · `pnpm test:e2e` · `pnpm lint:deps`
- `pnpm fixtures:check` clean after regeneration.
- **Project-specific check:** the emitted IR matches ADR 221's described shape for the touched plane (no `storage.namespaces` wrapper after GAP 1; `domain.<ns>` populated after GAP 2). Grep gate over the removed wrapper path.

**Priority.** Must-ship core (critical path: GAP 1 precedes S4).

#### S3 — Postgres public-by-default at the PSL interpreter

**Unit type:** Slice (single PR).

**Purpose.** Make the Postgres PSL interpreter interpret models that declare no explicit namespace as belonging to the `public` namespace. `__unbound__` becomes an explicit PSL opt-in rather than the implicit default. This removes the hardcoded `"public".`-prefixing logic from runtime/render and makes `public` a real, first-class namespace in the contract — the prerequisite for S4 emitting `"public"."user"` honestly rather than by string interpolation.

**Scope.** PSL interpreter default-namespace policy; deletion of the hardcoded `public`-prefix logic; regenerate all Postgres contract artifacts (demo, examples, fixtures) so un-namespaced models carry the `public` namespace. Existing integration test asserting the *absence* of a `"public".` prefix for unbound contracts is re-expressed for the new default.

**Depends on.** S2 (IR shape correct before regenerating artifacts against it).

**Validation gate.**

- `pnpm typecheck` · `pnpm test:packages` · `pnpm test:integration` · `pnpm test:e2e` · `pnpm lint:deps`
- `pnpm fixtures:check` clean after regeneration.
- **Project-specific check:** an un-namespaced Postgres model emits under the `public` namespace; opting a model into `__unbound__` in PSL is possible and round-trips.

**Linear:** ticket created at pickup.

**Priority.** Must-ship core.

#### S4 — runtime SQL qualification + default-namespace DSL/ORM fallback

**Unit type:** Slice (single PR; may split into ~2 dispatches).

**Purpose.** Runtime SQL emits namespace-qualified identifiers (Postgres `"public"."user"`; SQLite unqualified `"user"`; Mongo collection in the right namespace). DSL/ORM keeps its flat-by-name surface (`db.sql.<table>`, `db.<Model>`), with every lookup resolving through a per-family default namespace (`'public'` for Postgres now that S3 makes it real; `'__unbound__'` for Mongo/SQLite) so legacy query code keeps working unchanged. The fallback is the load-bearing backward-compatibility mechanism.

**Scope.** Family façade default-namespace constant; DSL `Db<C>` type-resolution path; ORM accessor type-resolution path; runtime SQL identifier-qualification at the relational-core / runtime layers (AST enrichment with `namespaceId` and/or renderer-side `(tableName, alias) → namespace` lookup).

**Linear:** [TML-2605](https://linear.app/prisma-company/issue/TML-2605).

**Depends on.** S2 GAP 1 (walks `storage.<ns>` directly) **and** S3 (the `public` namespace must exist for the qualified identifier to be honest).

**Validation gate.**

- `pnpm typecheck` · `pnpm test:packages` · `pnpm test:integration` · `pnpm test:e2e` · `pnpm lint:deps`
- `pnpm test:integration` loads the cross-namespace FK integration test plus a new regression test demonstrating default-namespace fallback works unchanged.
- **Project-specific check:** the demo app's `examples/prisma-next-demo/src/queries/*.ts` files compile and run unchanged; emitted SQL contains `"public"."user"`.

**Priority.** Must-ship core.

#### S5 — explicit namespace-aware DSL/ORM surface

**Unit type:** Slice (single PR). **Deferrable.**

**Purpose.** Add `db.sql.<ns>.<table>` and `db.<ns>.<Model>` for explicit multi-namespace navigation. Purely additive on S4's default-namespace fallback — default-namespace consumers see no change.

**Scope.** DSL accessor type construction (walks `contract.<plane>.<ns>` for per-namespace accessors); ORM accessor type construction; runtime resolution from the explicit surface to the same identifier-qualification path S4 established.

**Linear:** [TML-2550](https://linear.app/prisma-company/issue/TML-2550).

**Depends on.** S4.

**Priority.** Additive — only needed once a real multi-namespace consumer wants explicit navigation. Can land independently or be deferred to a sibling initiative with the deferral recorded in `deferred.md`.

### Parallel groups

None. Single sequential thread. GAP 2 is the only piece that is technically independent of the runtime work, but it stays in-line (right after GAP 1) rather than running as a parallel project — the coordination overhead exceeds the gain.

## Dependencies (external)

- [x] **PR #534 (TML-2520) merged.** Required base for S1; S1 closed on top of it.
- [x] **S1 closed.** ADR 221 captures the durable decisions; the IR substrate (two-plane model, entity coordinate, pack-contributed entity kinds) exists.
- [ ] **Supabase initiative awareness.** The downstream Supabase integration consumes this substrate. Coordinated at initiative-level — not a blocker, but the Supabase initiative's planning needs to know what S2–S4 ship and when.

## Project-DoD coverage map

| Project-DoD | Delivered by |
|---|---|
| **PDoD1.** All units delivered or deferred | S2 + S3 + S4 (must-ship); S5 (additive; deliver or defer with record) |
| **PDoD2.** Emitted contract IR matches ADR 221's canonical shape (`storage.<ns>` with no wrapper; `domain.<ns>` wired) | S2 (GAP 1 + GAP 2) |
| **PDoD3.** Un-namespaced Postgres models default to the `public` namespace; `__unbound__` is an explicit PSL opt-in; hardcoded `public`-prefix logic deleted | S3 |
| **PDoD4.** Runtime SQL identifier-qualification (demo emits `"public"."user"`) | S3 (makes `public` real) + S4 (renders it) |
| **PDoD5.** Existing consumers on default-namespace contracts experience zero query-API breakage | S3 (public default keeps un-namespaced authoring working) + S4 (default-namespace fallback) |
| **PDoD6.** Multi-namespace contract authorable + emittable + queryable end-to-end | S2 (shape) + S4 (queryable) |
| **PDoD7.** Pack-contributed entity-kind substrate exercised end-to-end (Postgres enum) | S1 (closed) |
| **PDoD8.** Long-lived ADRs migrated to `docs/architecture docs/adrs/` | Close-out (S1's ADR 221 already migrated; any S2–S4 ADRs) |
| **PDoD9.** Linear Project marked Completed | Close-out (auto via PR-merge integration) |
| **PDoD10.** Rolled-up project folders archived; umbrella folder deleted; repo-wide references stripped | Close-out |

## Risks + open questions

1. **Fixture churn cost (S2 + S3).** Both GAP 1 and S3 regenerate every on-disk contract. The fixture-regen path has been a repeated time-sink. Mitigation: lean on `pnpm fixtures:emit` / `pnpm fixtures:check`; the implementer brief calls out regeneration explicitly as part of "done."
2. **GAP 1 ↔ S4 merge order.** Both touch the storage-walk / identifier-emission paths. Mitigation handled by sequencing — GAP 1 lands first, S4 rebases on it.
3. **GAP 2 value vs cost.** GAP 2 (domain plane) is pure shape-correctness; it doesn't unblock the Supabase runtime story. It stays in must-ship to make the IR honestly match ADR 221, but if schedule pressure returns it is the first candidate to defer (records to `deferred.md`).
4. **S3 default-namespace policy blast radius.** Flipping the PSL default from `__unbound__` to `public` for Postgres regenerates every Postgres contract and re-expresses an existing integration test. Risk that downstream consumers pinned to the old shape break; this umbrella owns regenerating the in-repo artifacts, downstream consumers get upgrade instructions if their *source* shape changes.

## Sequencing visualisation

```text
S1 — contract-ir-planes (sub-project, 5 merged slices)   ✓ CLOSED  (ADR 221)
   │
   ▼
S2 — IR canonicalization
   ├─ GAP 1: drop storage.namespaces wrapper   → in progress (TML-2747)
   └─ GAP 2: wire domain plane
   │
   ▼
S3 — Postgres public-by-default at PSL
   │
   ▼
S4 — runtime SQL qualification + default-namespace fallback   (TML-2605)
   │
   ▼
S5 — explicit-namespace DSL (additive / deferrable)            (TML-2550)
   │
   ▼
Downstream: Supabase integration consumes this substrate
```

## Close-out (required)

- [ ] Verify all PDoDs in [`projects/target-extensible-ir-namespaces/spec.md`](./spec.md)
- [ ] Mandatory final retro complete; output landed in canonical / project-context / ADR
- [ ] Migrate any long-lived ADRs produced by S2–S4 into `docs/architecture docs/adrs/` (S1's ADR 221 already migrated)
- [ ] Archive / delete rolled-up predecessor project folders with long-lived contents migrated to `docs/`:
  - `projects/target-extensible-ir/` (substrate predecessor)
  - `projects/namespace-exemplar/` (TML-2520 / PR #534 predecessor)
- [ ] Strip repo-wide references to `projects/target-extensible-ir-namespaces/**` and all rolled-up sibling folders (replace with canonical `docs/` links or remove)
- [ ] Delete `projects/target-extensible-ir-namespaces/`
- [ ] Linear Project "Target-Extensible IR + Namespaces" marked Completed (auto via PR-merge integration when the close-out PR lands)
