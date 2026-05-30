# Project Plan: target-extensible-ir-namespaces

**Spec:** [`projects/target-extensible-ir-namespaces/spec.md`](./spec.md)
**Linear Project:** [Target-Extensible IR + Namespaces](https://linear.app/prisma-company/project/target-extensible-ir-namespaces-fd69eff8aec6)
**Purpose** _(from spec)_: Make first-class namespaces and target-extensible IR usable for the downstream Supabase integration. The IR gains a pack-contributed entity-kind mechanism (proven by Postgres enum migrating off the framework-shared `types` slot); runtime SQL and the DSL/ORM surfaces qualify identifiers and dispatch through default-namespace fallback so EA users on single-namespace contracts experience zero breakage; the explicit namespace-aware surface (`db.sql.auth.user`) ships post-EA as purely additive work.

## At a glance

Three units, single stack thread: **S1 (sub-project) → S2 (slice) → S3 (slice)**. S1 + S2 are pre-EA must-ship; S3 is post-EA additive. No parallelisation at the umbrella level — each unit gates the next on substrate, not just on convention. The umbrella plan delegates execution detail to S1 (now closed; durable decisions in [ADR 221](../../docs/architecture%20docs/adrs/ADR%20221%20-%20Contract%20IR%20two%20planes%20with%20uniform%20entity%20coordinate%20and%20pack-contributed%20entity%20kinds.md)) and to S2/S3 slice specs which will be authored via `drive-specify-slice` at pickup time.

## Composition

### Stack (deliver in order)

#### S1 — contract IR planes + pack-contributed entity-kind mechanism + Postgres enum migration

**Unit type:** Sub-project (multi-slice; closed — durable decisions in [ADR 221](../../docs/architecture%20docs/adrs/ADR%20221%20-%20Contract%20IR%20two%20planes%20with%20uniform%20entity%20coordinate%20and%20pack-contributed%20entity%20kinds.md)).

**Purpose.** Restructure the contract IR around two planes (`domain`, `storage`) with uniform `<plane>.<ns>.<entityKind>.<entityName>` indexing and canonical entity coordinates. Add the pack-contributed entity-kind descriptor mechanism. Migrate Postgres enum off the framework-shared `types` slot as the substrate's load-bearing exemplar.

**Scope.** ~50 source files across framework / SQL family / Postgres target / emitter + ~10 on-disk contracts. Delivered across five merged slices; durable decisions in [ADR 221](../../docs/architecture%20docs/adrs/ADR%20221%20-%20Contract%20IR%20two%20planes%20with%20uniform%20entity%20coordinate%20and%20pack-contributed%20entity%20kinds.md).

**Linear:** [TML-2584](https://linear.app/prisma-company/issue/TML-2584). Six internal-slice tickets need creating before slice pickup (folded into the Linear audit pass).

**Depends on.** PR #534 (TML-2520) merged. Met at commit `66da80f96`.

**Validation gate.** Each S1 slice has its own validation gate (see S1's plan). S1 closes when all six slices land and S1's PDoD1-PDoD11 are met.

**Pre/Post-EA.** Pre-EA must-ship.

#### S2 — runtime SQL qualification + default-namespace DSL/ORM fallback

**Unit type:** Slice (single PR).

**Purpose.** Close the runtime loop on PR #534's namespace IR: runtime SQL emits namespace-qualified identifiers; DSL/ORM reads through per-family default-namespace fallback (`'public'` for Postgres; `'__unbound__'` for Mongo/SQLite) so legacy query code keeps working unchanged. The fallback is the load-bearing EA-protection mechanism.

**Scope.** ~10-12 files: family façade hardcoded `defaultNamespace` constant; DSL `Db<C>` type-resolution path; ORM accessor type-resolution path; runtime SQL identifier-qualification at the relational-core / runtime layers. Slice spec authored via `drive-specify-slice` at pickup time; lands at `projects/target-extensible-ir-namespaces/slices/runtime-qualification/spec.md`.

**Linear:** [TML-2605](https://linear.app/prisma-company/issue/TML-2605).

**Depends on.** S1 (consumes the two-plane IR shape + entity coordinate; the qualification path needs `Storage.elementCoordinates()` to walk).

**Validation gate.**

- `pnpm typecheck`
- `pnpm test:packages`
- `pnpm test:integration` (loads the cross-namespace FK integration test plus a new regression test demonstrating default-namespace fallback works unchanged)
- `pnpm test:e2e`
- `pnpm lint:deps`
- **Project-specific check:** the demo app's `examples/prisma-next-demo/src/queries/*.ts` files compile and run unchanged after S2 lands. (Surfaces FR5 satisfaction.)

**Pre/Post-EA.** Pre-EA must-ship.

#### S3 — explicit namespace-aware DSL/ORM surface

**Unit type:** Slice (single PR).

**Purpose.** Add `db.sql.<ns>.<table>` and `db.<ns>.<Model>` for explicit multi-namespace navigation. Purely additive on S2's default-namespace fallback — non-default-namespace consumers opt in to the explicit surface; default-namespace consumers see no change.

**Scope.** ~8-10 files: DSL accessor type construction (the `Db<C>` type machinery walks `contract.<plane>.<ns>` to produce per-namespace accessors); ORM accessor type construction; runtime resolution from the explicit surface to the same identifier-qualification path S2 established. Slice spec authored via `drive-specify-slice` at pickup time; lands at `projects/target-extensible-ir-namespaces/slices/explicit-namespace-dsl/spec.md`.

**Linear:** [TML-2550](https://linear.app/prisma-company/issue/TML-2550).

**Depends on.** S2 (the explicit surface is additive; it reuses S2's qualification path under the hood).

**Validation gate.**

- `pnpm typecheck`
- `pnpm test:packages`
- `pnpm test:integration` (includes a multi-namespace integration test demonstrating `db.sql.auth.user` works alongside `db.sql.user` for the default namespace)
- `pnpm test:e2e`
- `pnpm lint:deps`
- **Project-specific check:** demo app migrates one query from `db.sql.user` to `db.sql.public.user` (explicit-namespace form) and both forms compile + run.

**Pre/Post-EA.** Post-EA additive.

### Parallel groups

None. Single stack thread S1 → S2 → S3.

S2 cannot start until S1 ships the two-plane IR shape (S2's qualification path needs to walk `contract.storage.<ns>.<entityKind>` generically). S3 cannot start until S2 ships the qualification path (S3 builds the explicit-namespace surface on top of S2's resolution mechanism).

Within S1, S1's own plan defines parallelisation opportunities (Slices 4 + 5 are parallelisable per its plan). Those are S1-internal sequencing decisions and don't surface at the umbrella level.

## Dependencies (external)

- [x] **PR #534 (TML-2520) merged.** Met at commit `66da80f96`. Required base for S1.
- [x] **Linear audit completed** 2026-05-20. Triage outcomes:
  - **Mainline (refreshed descriptions):** TML-2584 (S1), TML-2605 (S2), TML-2550 (S3)
  - **S1 internal slice tickets created:** TML-2622 (S1.A), TML-2623 (S1.B), TML-2624 (S1.C), TML-2625 (S1.D) — all `relatedTo` TML-2584
  - **Subsumed by S1 (auto-close on slice PR merge):** TML-2579, TML-2580, TML-2582, TML-2545, TML-2563, TML-2586
  - **Out-of-umbrella (stay in Linear project for discoverability):** TML-2537 (TML-2537 PSL substrate), TML-2541, TML-2542, TML-2543, TML-2540, TML-2513
  - **No action needed:** TML-2583 (orthogonal; spec § non-goals already covers); previously-resolved TML-2459/2520/2521/2575/2576/2577/2578/2581
- [ ] **Supabase initiative awareness.** The downstream Supabase integration consumes this umbrella's substrate. Coordinated at initiative-level — not a blocker for this umbrella, but the Supabase initiative's planning needs to know what S1 ships and when.

## Project-DoD coverage map

| Project-DoD | Delivered by |
|---|---|
| **PDoD1.** All units delivered or deferred | S1 + S2 (pre-EA) + S3 (post-EA, or deferred to a sibling initiative) |
| **PDoD2.** Multi-namespace contract authorable + emittable + queryable end-to-end | S1 (authoring + emission) + S2 (queryable) |
| **PDoD3.** Pack-contributed entity-kind substrate exercised end-to-end (Postgres enum migration) | S1 (inherits its own PDoD3) |
| **PDoD4.** Runtime SQL identifier-qualification | S2 |
| **PDoD5.** EA users on default-namespace contracts experience zero query-API breakage | S2 (default-namespace fallback) + verified across S1+S2 landings |
| **PDoD6.** Long-lived ADRs migrated to `docs/architecture docs/adrs/` | Close-out task; lifts ADRs from S1 + any S2/S3 ADRs |
| **PDoD7.** Linear Project marked Completed | Close-out task (auto via PR-merge integration) |
| **PDoD8.** Rolled-up project folders archived; umbrella folder deleted | Close-out task |
| **PDoD9.** Repo-wide references stripped | Close-out task |

## Risks + open questions

1. **EA timeline slip.** A2 in the spec is the binding constraint. Honest budget for pre-EA scope is ~12-15 days (S1: 10-12 + S2: 2-3); "few days" framing was unrealistic. Working position is to slip pre-EA by 1-2 weeks rather than ship breaking IR changes into EA. If the slip is unacceptable to the team, the conversation re-opens at umbrella level — options are (a) ship without S1's IR reshape and accept breaking changes for EA users when S1 lands later, (b) compress S1 via aggressive parallelism (compression-sprint plan, previously discarded), or (c) defer S2's namespace-qualification too and ship EA on the unchanged surface with namespaces deferred to the next minor.
2. **S1 internal slice falsifications cascade to umbrella.** *(Resolved — S1 closed; durable decisions in [ADR 221](../../docs/architecture%20docs/adrs/ADR%20221%20-%20Contract%20IR%20two%20planes%20with%20uniform%20entity%20coordinate%20and%20pack-contributed%20entity%20kinds.md).)* S1's assumptions held without forcing an umbrella-level re-sequencing of S2 / S3.
3. **A4 default-namespace fallback sufficiency.** If EA users start writing multi-namespace contracts before S3 lands, the flat DSL surface becomes inadequate and S3's post-EA window compresses. Mitigation: EA release notes communicate the namespace-aware surface as "coming soon."
4. **Linear audit surfaces unexpected scope.** The 21 Linear tickets currently in the project may include work that wasn't accounted for in this umbrella's three-unit composition. If audit surfaces real-scope work the umbrella missed, the plan re-opens.

## Sequencing visualisation

```text
PR #534 ✓ (merged)
   │
   ▼
S1 — contract-ir-planes (sub-project, 6 slices internally, ~10-12 days)
   │
   ▼
S2 — runtime-qualification (slice, ~2-3 days)
   │
   ▼   ←  EA cut here
S3 — explicit-namespace-dsl (slice, ~2-3 days, additive, post-EA)
   │
   ▼
Downstream: Supabase integration consumes this substrate
```

## Close-out (required)

- [ ] Verify all PDoDs in [`projects/target-extensible-ir-namespaces/spec.md`](./spec.md)
- [ ] Mandatory final retro complete; output landed in canonical / project-context / ADR
- [ ] Migrate long-lived ADRs into `docs/architecture docs/adrs/`:
  - S1's `0001-contract-planes.md`
  - Any S2/S3 ADRs produced during execution
- [ ] Archive / delete rolled-up project folders with long-lived contents migrated to `docs/`:
  - `projects/target-extensible-ir/` (substrate predecessor)
  - `projects/namespace-exemplar/` (TML-2520 / PR #534 — predecessor)
  - S1 sub-project (closed; folder removed at its own close-out — durable decisions migrated to [ADR 221](../../docs/architecture%20docs/adrs/ADR%20221%20-%20Contract%20IR%20two%20planes%20with%20uniform%20entity%20coordinate%20and%20pack-contributed%20entity%20kinds.md))
- [ ] Strip repo-wide references to `projects/target-extensible-ir-namespaces/**` and all rolled-up sibling folders (replace with canonical `docs/` links or remove)
- [ ] Delete `projects/target-extensible-ir-namespaces/`
- [ ] Linear Project "Target-Extensible IR + Namespaces" marked Completed (auto via PR-merge integration when the close-out PR lands)
