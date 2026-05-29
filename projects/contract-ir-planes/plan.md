# Project Plan: contract-ir-planes

**Spec:** [`projects/contract-ir-planes/spec.md`](./spec.md)
**ADR:** [`projects/contract-ir-planes/adrs/0001-contract-planes.md`](./adrs/0001-contract-planes.md)
**Linear Project:** [Target-Extensible IR + Namespaces](https://linear.app/prisma-company/project/target-extensible-ir-namespaces-fd69eff8aec6) — one sub-project under the umbrella; tracking ticket [TML-2584](https://linear.app/prisma-company/issue/TML-2584)

**Purpose** _(from spec)_: Make the contract IR target-extensible at the entity-kind level — target packs contribute new entity kinds through a single framework-level mechanism with a uniform IR shape every consumer can walk by entity coordinate. Without this restructure every new pack-contributed kind would hardcode itself into the framework the way Postgres enum currently does; the substrate this project builds is what makes the rest of the umbrella ship.

## At a glance

The substrate (planes + entity coordinate + pack-contributed kinds) and both of its load-bearing migrations are merged. What remains is reaping the helpers the structural work made redundant. A 2026-05-29 inventory found the original single "reap" slice (S1.D) was really ~5 coherent slices: three are clean deletes with no structural prerequisite, three require structural changes (a `contract.json`-shape coordinate change, a hash-computation change, a query-builder type rewrite). Per the **narrow-and-defer** decision, S1.D ships the **three clean deletes now** (parallelisable, disjoint files) and **defers the three structural items** to follow-ups (recorded in [`deferred.md`](./deferred.md)). Alongside runs **one parallel correctness fix** (S1.E) the structural work surfaced. Everything remaining is parallel — no stack.

## Delivered / in-flight

These slices are done or in final review; their as-built dispatch history lives in [`drive/retro/findings.md`](../../drive/retro/findings.md), not here.

| Slice | Linear | Delivers | State |
|---|---|---|---|
| **S1.A** — substrate: two-plane IR primitives + entity coordinate + pack-contributed entity-kind mechanism | [TML-2622](https://linear.app/prisma-company/issue/TML-2622) | PDoD5 (Namespace narrowing), PDoD6 (`elementCoordinates` free function), PDoD7 (descriptor-driven hydration) | Merged |
| **S1.B** — enum migration off the framework-shared `types` slot | [TML-2623](https://linear.app/prisma-company/issue/TML-2623) (PR #595) | PDoD3 (enum at `storage.<ns>.enum`; framework no longer names `'postgres-enum'`) | Merged |
| **S1.C** — cross-reference encoding migration (object pairs) | [TML-2624](https://linear.app/prisma-company/issue/TML-2624) (PR #600) | PDoD4 (object pairs for `relation.to`, `model.base`, `roots[*]`) | In final review — about to merge |

## Composition (remaining)

S1.D is tracked by [TML-2727](https://linear.app/prisma-company/issue/TML-2727) as one effort delivered as **three independent slices** (each its own PR referencing TML-2727). The inventory confirmed they touch disjoint files with no inter-dependency, so all three run **in parallel**, in separate worktrees off the shared replan base.

### Parallel group A — S1.D clean deletes (independent of each other)

1. **Slice S1.D-1 — Construction-discipline shims** — spec: [`slices/construction-discipline-shims/spec.md`](./slices/construction-discipline-shims/spec.md)
   - **Outcome:** `SqlNamespacePayload` / `MongoNamespacePayload`, `normaliseNamespaceEntry` (×2), and `DEFAULT_NAMESPACES` (×2) no longer exist. `SqlStorage` / `MongoStorage` constructors require fully-constructed `Namespace` instances — no POJO normalisation at construction, no default-singleton injection. Authoring builders are the sole construction point and already hand over built namespaces.
   - **Builds on:** S1.A's `Namespace` class + builder construction path; S1.C's object-pair encoding (no name-keyed lookups remain that needed the default singleton).
   - **Hands to:** Project close-out grep gate (these symbols vanish). May produce minor fixture regen if any contract relied on default-namespace injection — bounded, the slice owns the regen.
   - **Focus:** Constructor-contract tightening + deletion. Reviewer checks: does any caller still pass a POJO / rely on the injected default?

2. **Slice S1.D-2 — Canonicalizer family hook** — spec: [`slices/canonicalizer-family-hook/spec.md`](./slices/canonicalizer-family-hook/spec.md) — closes [TML-2579](https://linear.app/prisma-company/issue/TML-2579)
   - **Outcome:** The framework canonicalizer's SQL-specific preserve-empty guards + `sortIndexesAndUniques` are replaced by family-contributed `shouldPreserveEmptyAt` / `sortStorage` hooks. The framework no longer hardcodes SQL-shaped knowledge. **Output-preserving** — canonical bytes are identical before/after (fixtures must not move).
   - **Builds on:** S1.A's family-contribution mechanism (the hook rides the existing contribution surface).
   - **Hands to:** Completes the PDoD6 consumer migration — the last SQL-specific framework canonicalizer path becomes a family hook.
   - **Focus:** Move-don't-change. Reviewer checks: byte-identical canonical output; no framework→family circular import (risk #1 below).

3. **Slice S1.D-3 — Migration aggregate → `elementCoordinates`** — spec: [`slices/migration-element-coordinates/spec.md`](./slices/migration-element-coordinates/spec.md) — closes [TML-2580](https://linear.app/prisma-company/issue/TML-2580)
   - **Outcome:** `extractStorageElementNames`'s callers in `1-framework/3-tooling/migration` walk via `elementCoordinates(storage)`; the `StorageBase` vs `Storage` type gap is resolved; the helper is deleted. **Output-preserving** — no on-disk shape change.
   - **Builds on:** S1.A's `elementCoordinates` free function.
   - **Hands to:** Project close-out grep gate.
   - **Focus:** Call-site rewrite + deletion. Reviewer checks: identical migration behaviour; the type-gap resolution doesn't widen any public surface.

**Deferred from S1.D** (structural prerequisites — recorded in [`deferred.md`](./deferred.md), ticketed when picked up): `SqlModelStorage` namespaced coordinate → `findSqlTable` + `assertUniqueSqlTableNames`; `kind`-agnostic hashing → `stripNamespaceKinds`; namespace-aware query-builder selection → query-builder `UnboundTables`.

### Parallel group B (independent of group A)

- **Slice S1.E — Namespace-aware enum planning (Postgres planner correctness fix)** — Linear: [TML-2686](https://linear.app/prisma-company/issue/TML-2686)
  - **Outcome:** The Postgres migration planner keys enum lookups by `(namespaceId, name)` rather than bare name, so two namespaces holding an enum of the same name no longer collide. Enum lookup, enum collection, the consuming plan strategies, and the live-schema `readExistingEnumValues` read all thread the namespace coordinate; `EnumValuesChangedIssue` carries the namespace so verifier-produced issues are unambiguous.
  - **Builds on:** None. The bug pre-dates this project (it exists on `origin/main`); the planner surface is disjoint from the structural slices. Independent of S1.C and S1.D.
  - **Hands to:** Nothing in-project — this is a self-contained correctness fix.
  - **Focus:** Postgres planner internals + the `SchemaIssue` shape. No on-disk `contract.json` format change. Adopted into this project for convenience because the structural work surfaced it; it satisfies no project PDoD (see § Scope note).

## Dependencies (external)

- [x] **PR #534 merged** (predecessor; namespace exemplar) — landed at commit `66da80f96`.
- [x] **S1.C merged** (PR #600) — was S1.D's only hard dependency. All three clean-delete slices are now unblocked: object-pair encoding is the sole reader, so the name-keyed helpers have no remaining consumers.
- [ ] **EA timeline** — pre-EA must-ship status is decided at the umbrella level; see [`projects/target-extensible-ir-namespaces/plan.md`](../target-extensible-ir-namespaces/plan.md). Does not gate the remaining slices.

## Scope note — S1.E is an adopted, not purpose-serving, slice

S1.E closes a pre-existing Postgres planner bug; it advances correctness, not the project's *purpose* (target-extensibility of the IR). It is kept in-project (rather than spun out as an orphan slice) because the structural work surfaced it and the ticket already exists, but it is sequenced **parallel** to the critical path so it never blocks S1.D. If the project needs to close before S1.E lands, reclassify S1.E as an orphan slice under TML-2686 — it gates no PDoD, so removing it from the project leaves PDoD1 satisfiable by S1.D alone.

## Remaining Project-DoD coverage

PDoD1–PDoD4 and PDoD7 are delivered or in review (table above). Remaining:

| Project-DoD | Closed by |
|---|---|
| **PDoD5 (amended)** — `Namespace` narrowed; the *cleanly-removable* subsumed helpers deleted; grep gate clean over them | S1.D-1 + S1.D-2 + S1.D-3 (deletions + per-slice grep gates). **Amended 2026-05-29:** three structural helpers (`findSqlTable`/`assertUniqueSqlTableNames`, `stripNamespaceKinds`, query-builder `UnboundTables`) are explicitly **out of this project's PDoD5** and deferred — see [`deferred.md`](./deferred.md). The grep gate covers only the symbols this project deletes. |
| **PDoD6** — `elementCoordinates(storage)` consumed by planner / migration / validators | S1.D-3 (migration consumer migrated) + S1.D-2 (canonicalizer family hook). Planner / validator consumers landed in S1.A. |
| **PDoD8** — all validation gates clean | Each remaining slice's gate + final retro gate |
| **PDoD9** — ADR migrated to `docs/architecture docs/adrs/` | Close-out |
| **PDoD10** — subsumed tickets (TML-2579/2580/2582) closed | ✅ already satisfied — all Canceled in the 2026-05-20 ticket cleanup. (S1.D-2 closes TML-2579, S1.D-3 closes TML-2580 on merge; TML-2582 stays Canceled until the deferred query-builder follow-up.) |
| **PDoD11** — project folder deleted; references stripped | Close-out |

## Sequencing rationale

- **S1.D narrowed, not whole:** the 2026-05-29 inventory falsified the "one deletions-only slice" premise — three of the eight subsumed surfaces carry structural prerequisites (a `contract.json`-shape coordinate change with hash regen, a hash-computation change, a query-builder type rewrite) that each warrant their own review focus and risk profile. Bundling them with the clean deletes would make one un-reviewably broad PR. They are deferred to follow-ups so the clean deletes ship now without waiting on structural work.
- **S1.D-1/-2/-3 in parallel:** the three clean-delete slices touch disjoint files (contract-IR constructors vs framework canonicalizer + family hooks vs migration tooling) with no inter-dependency. Only S1.D-1 may regen fixtures; S1.D-2 and S1.D-3 are output-preserving. The real limit on concurrency is reviewer bandwidth, not technical coupling.
- **S1.E parallel, not stacked:** the planner-correctness surface is disjoint from the structural slices and the bug pre-dates the project. Under the default-to-parallel principle it runs alongside S1.D. (If a single reviewer is the bottleneck, pace the PRs — that is a reviewer-bandwidth decision, not a dependency.)

## Risks + open questions

1. **Canonicalizer family-contribution hook (A7) — S1.D-2.** S1.D-2 replaces the framework canonicalizer's SQL-specific preserve-empty paths with a family-contribution hook. If the hook design would force framework-components to import family code (circular dependency), the pattern doesn't hold: S1.D-2 is abandoned, the SQL-specific path stays, and TML-2579 stays open. Refusal trigger — the implementer halts and reports rather than introducing a cycle. Output must stay byte-identical (fixtures must not move); any fixture drift is a signal the move changed behaviour and is itself a halt condition.
2. **S1.E `SchemaIssue` blast radius.** S1.E adds required `namespaceId` to `EnumValuesChangedIssue` and tightens population at every verifier enum-issue construction site. Integration goldens that snapshot Issue payloads (likely under `packages/3-targets/3-targets/postgres/test/migrations/`) shift shape-only (`+ namespaceId`). Risk materialises only if the goldens audit surfaces *content* drift (issue ordering, or an unexpected namespace value) beyond the field addition — that would expand the slice. Refusal trigger on content drift beyond the field addition.

## Close-out (required)

- [ ] Verify all PDoDs in [`projects/contract-ir-planes/spec.md`](./spec.md)
- [ ] Mandatory final retro complete; output landed in canonical / project-context / ADR
- [ ] Migrate [`adrs/0001-contract-planes.md`](./adrs/0001-contract-planes.md) into `docs/architecture docs/adrs/`
- [ ] Strip repo-wide references to `projects/contract-ir-planes/**` (replace with canonical `docs/` links or remove)
- [ ] Delete `projects/contract-ir-planes/`
- [ ] Linear Project marked Completed (auto via PR-merge integration; tickets reference `TML-2584` in PR titles/bodies)
