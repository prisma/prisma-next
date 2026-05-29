# Project Plan: contract-ir-planes

**Spec:** [`projects/contract-ir-planes/spec.md`](./spec.md)
**ADR:** [`projects/contract-ir-planes/adrs/0001-contract-planes.md`](./adrs/0001-contract-planes.md)
**Linear Project:** [Target-Extensible IR + Namespaces](https://linear.app/prisma-company/project/target-extensible-ir-namespaces-fd69eff8aec6) — one sub-project under the umbrella; tracking ticket [TML-2584](https://linear.app/prisma-company/issue/TML-2584)

**Purpose** _(from spec)_: Make the contract IR target-extensible at the entity-kind level — target packs contribute new entity kinds through a single framework-level mechanism with a uniform IR shape every consumer can walk by entity coordinate. Without this restructure every new pack-contributed kind would hardcode itself into the framework the way Postgres enum currently does; the substrate this project builds is what makes the rest of the umbrella ship.

## At a glance

The substrate (planes + entity coordinate + pack-contributed kinds) and both of its load-bearing migrations are delivered or in final review. **One in-project slice remains** — S1.D, which reaps the helpers the structural work made redundant. Alongside it runs **one parallel correctness fix** (S1.E) the structural work surfaced. Short stack of one, plus one independent parallel slice.

## Delivered / in-flight

These slices are done or in final review; their as-built dispatch history lives in [`drive/retro/findings.md`](../../drive/retro/findings.md), not here.

| Slice | Linear | Delivers | State |
|---|---|---|---|
| **S1.A** — substrate: two-plane IR primitives + entity coordinate + pack-contributed entity-kind mechanism | [TML-2622](https://linear.app/prisma-company/issue/TML-2622) | PDoD5 (Namespace narrowing), PDoD6 (`elementCoordinates` free function), PDoD7 (descriptor-driven hydration) | Merged |
| **S1.B** — enum migration off the framework-shared `types` slot | [TML-2623](https://linear.app/prisma-company/issue/TML-2623) (PR #595) | PDoD3 (enum at `storage.<ns>.enum`; framework no longer names `'postgres-enum'`) | Merged |
| **S1.C** — cross-reference encoding migration (object pairs) | [TML-2624](https://linear.app/prisma-company/issue/TML-2624) (PR #600) | PDoD4 (object pairs for `relation.to`, `model.base`, `roots[*]`) | In final review — about to merge |

## Composition (remaining)

### Stack (deliver in order)

1. **Slice S1.D — Reap subsumed surfaces** — Linear: [TML-2727](https://linear.app/prisma-company/issue/TML-2727)
   - **Outcome:** The asymmetry-driven helpers that the new coordinate makes redundant are gone, and the entity coordinate is the only way the codebase walks IR entities. `findSqlTable`, `assertUniqueSqlTableNames`, `extractStorageElementNames`, `SqlNamespacePayload`, `DEFAULT_NAMESPACES`, `normaliseNamespaceEntry`, `stripNamespaceKinds`, and `UnboundTables<C>` no longer exist; remaining callers walk via the free-function `elementCoordinates(storage)`; the framework canonicalizer's SQL-specific preserve-empty paths are replaced by a family-contribution hook.
   - **Builds on:** S1.C's `hands to` — object-pair cross-references live at every site, so the old name-keyed helpers have no remaining readers and can be deleted without leaving a consumer stranded.
   - **Hands to:** Project close-out — a grep-clean tree (PDoD5 gate) and the canonicalizer family hook standing in for the last SQL-specific framework path (completes the PDoD6 consumer migration). (The subsumed Linear tickets TML-2579/2580/2582 are already Canceled, so PDoD10 needs no close-out dispatch here.)
   - **Focus:** Deletions and call-site rewrites only. The structural shape (planes, coordinate, descriptor mechanism, encodings) is already shipped by S1.A–S1.C and is **not** re-opened here. Reviewer reads this slice for deletion correctness — does anything still depend on a removed surface? — without structural context-switching.

### Parallel group A (independent of the stack)

- **Slice S1.E — Namespace-aware enum planning (Postgres planner correctness fix)** — Linear: [TML-2686](https://linear.app/prisma-company/issue/TML-2686)
  - **Outcome:** The Postgres migration planner keys enum lookups by `(namespaceId, name)` rather than bare name, so two namespaces holding an enum of the same name no longer collide. Enum lookup, enum collection, the consuming plan strategies, and the live-schema `readExistingEnumValues` read all thread the namespace coordinate; `EnumValuesChangedIssue` carries the namespace so verifier-produced issues are unambiguous.
  - **Builds on:** None. The bug pre-dates this project (it exists on `origin/main`); the planner surface is disjoint from the structural slices. Independent of S1.C and S1.D.
  - **Hands to:** Nothing in-project — this is a self-contained correctness fix.
  - **Focus:** Postgres planner internals + the `SchemaIssue` shape. No on-disk `contract.json` format change. Adopted into this project for convenience because the structural work surfaced it; it satisfies no project PDoD (see § Scope note).

## Dependencies (external)

- [x] **PR #534 merged** (predecessor; namespace exemplar) — landed at commit `66da80f96`.
- [x] **S1.C in final review** — S1.D's only hard dependency. S1.D pickup waits on S1.C merge.
- [ ] **EA timeline** — pre-EA must-ship status is decided at the umbrella level; see [`projects/target-extensible-ir-namespaces/plan.md`](../target-extensible-ir-namespaces/plan.md). Does not gate the remaining slices.

## Scope note — S1.E is an adopted, not purpose-serving, slice

S1.E closes a pre-existing Postgres planner bug; it advances correctness, not the project's *purpose* (target-extensibility of the IR). It is kept in-project (rather than spun out as an orphan slice) because the structural work surfaced it and the ticket already exists, but it is sequenced **parallel** to the critical path so it never blocks S1.D. If the project needs to close before S1.E lands, reclassify S1.E as an orphan slice under TML-2686 — it gates no PDoD, so removing it from the project leaves PDoD1 satisfiable by S1.D alone.

## Remaining Project-DoD coverage

PDoD1–PDoD4 and PDoD7 are delivered or in review (table above). Remaining:

| Project-DoD | Closed by |
|---|---|
| **PDoD5** — `Namespace` narrowed; subsumed helpers deleted; grep gate clean | S1.D (deletions + grep gate) |
| **PDoD6** — `elementCoordinates(storage)` consumed by planner / migration / validators | S1.D (final consumer migration + canonicalizer hook) |
| **PDoD8** — all validation gates clean | Each remaining slice's gate + final retro gate |
| **PDoD9** — ADR migrated to `docs/architecture docs/adrs/` | Close-out |
| **PDoD10** — subsumed tickets (TML-2579/2580/2582) closed | ✅ already satisfied — all Canceled in the 2026-05-20 ticket cleanup |
| **PDoD11** — project folder deleted; references stripped | Close-out |

## Sequencing rationale

- **S1.D after S1.C, not parallel:** the subsumed helpers can only come out once the new coordinate / object-pair encoding is the *sole* reader. Deleting them while S1.C is still in review would strand callers mid-migration. This is a real dependency, not pacing.
- **S1.E parallel, not stacked:** the planner-correctness surface is disjoint from the structural slices and the bug pre-dates the project. The previous plan sequenced it after S1.D to keep reviewer attention on the critical path; under the default-to-parallel principle that serialization is throughput lost for no dependency reason, so it is parallelised. (If a single reviewer is the bottleneck, pull S1.E after S1.D as a pacing choice — but that is a reviewer-bandwidth decision, not a dependency.)

## Risks + open questions

1. **Canonicalizer family-contribution hook (A7).** S1.D replaces the framework canonicalizer's SQL-specific preserve-empty paths with a family-contribution hook. If the hook design would force framework-components to import family code (circular dependency), the pattern doesn't hold: S1.D's scope shrinks and TML-2579 stays open as a standalone follow-up. Discussion-mode re-entry trigger if it surfaces.
2. **S1.E `SchemaIssue` blast radius.** S1.E adds required `namespaceId` to `EnumValuesChangedIssue` and tightens population at every verifier enum-issue construction site. Integration goldens that snapshot Issue payloads (likely under `packages/3-targets/3-targets/postgres/test/migrations/`) shift shape-only (`+ namespaceId`). Risk materialises only if the goldens audit surfaces *content* drift (issue ordering, or an unexpected namespace value) beyond the field addition — that would expand the slice. Refusal trigger on content drift beyond the field addition.

## Close-out (required)

- [ ] Verify all PDoDs in [`projects/contract-ir-planes/spec.md`](./spec.md)
- [ ] Mandatory final retro complete; output landed in canonical / project-context / ADR
- [ ] Migrate [`adrs/0001-contract-planes.md`](./adrs/0001-contract-planes.md) into `docs/architecture docs/adrs/`
- [ ] Strip repo-wide references to `projects/contract-ir-planes/**` (replace with canonical `docs/` links or remove)
- [ ] Delete `projects/contract-ir-planes/`
- [ ] Linear Project marked Completed (auto via PR-merge integration; tickets reference `TML-2584` in PR titles/bodies)
