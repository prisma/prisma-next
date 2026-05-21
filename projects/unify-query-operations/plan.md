# Project Plan: unify-query-operations

**Spec:** `projects/unify-query-operations/spec.md`
**Linear issue:** TML-2354 (single tracking issue — no sub-issues per slice; each slice PR references TML-2354 in its title/body so the GitHub integration links them).
**Purpose** _(from spec)_: Unify built-in and extension query operations behind a single SQL-family operation registry shipped by `@prisma-next/family-sql`. Delete `COMPARISON_METHODS_META` (ORM) and `BuiltinFunctions` (sql-builder); both authoring surfaces source every operation — common or not — from the same registry. Trait-target `self` so a codec's declared traits determine reachability uniformly across surfaces.

## At a glance

Five slices, **all stack** (each depends on the previous). One foundation slice (`SelfSpec.any` arm) unlocks the family factory + wiring slice, which unlocks the consumer-collapse slice (the big one — deletes both legacy surfaces and splits the orderBy callback accessor in the same atomic change). A small HAVING-derivation slice follows, then the ADR close-out. No parallel groups: the project is a linear stack because each slice removes/replaces code the next one touches.

## Composition

### Stack (deliver in order)

1. **Slice `self-any-arm`** — Add the `{ any: true }` third arm to `SelfSpec`, extend the registration validator, the ORM model accessor's `self` resolution loop, and the type-level `OpMatchesField` matcher. Foundation: no user-visible surface change yet; just makes "applies to every codec" expressible. Scope: `packages/1-framework/1-core/operations/src/index.ts`, `packages/3-extensions/sql-orm-client/src/{model-accessor.ts,types.ts}`. Linear: TML-2354 (no sub-issue). Depends on: none.
2. **Slice `family-ops-factory`** — Ship `sqlFamilyOperations<CT>()` in `@prisma-next/family-sql` covering all 15 family operations (`eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `like`, `in`, `notIn`, `isNull`, `isNotNull`, `and`, `or`, `exists`, `notExists`). Trait-target `self` per the spec table. Wire the family pack as a fourth contributor in `createExecutionContext` so `queryOperations()` fires. Add the family's `queryOperationTypes` to the emitter alias-aggregation step so `Contract['queryOperationTypes']` includes them. At end of slice the registry contains the entries but neither consumer reads them yet — `COMPARISON_METHODS_META` and `BuiltinFunctions` still take precedence (registry entries are inert backups). Scope: `packages/2-sql/9-family/src/core/`, `packages/2-sql/9-family/src/exports/`, `packages/2-sql/5-runtime/src/sql-context.ts`, `packages/2-sql/3-tooling/emitter/src/index.ts`, family-sql tests. Linear: TML-2354 (no sub-issue). Depends on: slice 1 (uses `self: { any: true }` for `isNull`/`isNotNull`).
3. **Slice `collapse-consumers`** — Delete `COMPARISON_METHODS_META`, `ComparisonMethodFns`, `BuiltinFunctions<CT>`, `createBuiltinFunctions`. Collapse the ORM model accessor's two-loop synthesis to a single registry loop. Drop the `BuiltinFunctions<CT> &` intersection from `Functions<QC>` so `fns` derives purely from `DeriveExtFunctions<QC['queryOperationTypes']>`. Introduce the **ORM ordering registry** (private to `sql-orm-client`) with `asc`/`desc`. Split the `orderBy` callback accessor from the WHERE-style column accessor — `orderBy` selectors now receive an `OrderByModelAccessor` that only carries `asc`/`desc`; WHERE accessors lose the cosmetic `.asc/.desc` leak. The user-visible trait tightening for cipherstash on `fns.eq` lands here (per spec § "Side-effect: trait gating becomes uniform"). The cipherstash `equality-trait-removal.test.ts` doc-comment that references `COMPARISON_METHODS_META` updates in the same diff. Scope: `packages/3-extensions/sql-orm-client/src/{model-accessor.ts,types.ts,collection.ts}`, `packages/2-sql/4-lanes/sql-builder/src/{expression.ts,runtime/functions.ts}`, `packages/3-extensions/cipherstash/test/equality-trait-removal.test.ts`. Linear: TML-2354 (no sub-issue). Depends on: slice 2 (the registry must already carry the family entries before the consumers can read them).
4. **Slice `derive-having-surface`** — Delete `HavingComparisonMethods<T>` (the hand-listed `Pick<…>`). Derive the HAVING aggregate selector's method surface from the SQL family registry by the predicate-return filter rule (FR22): ops whose `self` matches the aggregate's return codec **and** whose return codec carries the `boolean` trait. The net surface on numeric aggregates widens to `eq | neq | in | notIn | gt | lt | gte | lte | isNull | isNotNull` (a deliberate, documented widening). Add type-level tests. Scope: `packages/3-extensions/sql-orm-client/src/types.ts`, the `HavingBuilder` consumer sites, type-level tests. Linear: TML-2354 (no sub-issue). Depends on: slice 3 (the family registry must be the sole source of truth before HAVING can derive from it).
5. **Slice `adr-close-out`** — Draft the new ADR ("ADR NNN — Unified SQL-family operation registry") under `docs/architecture docs/adrs/`. Record the unified-registry decision and explicitly supersede the "Migration of built-in comparisons …" and "Changing the built-in comparison methods" non-goal lines in ADR 203 and ADR 206. Add a "Superseded in part by ADR NNN" header note to each. Then perform the project close-out: migrate long-lived docs (if any emerged), strip repo-wide references to `projects/unify-query-operations/**`, and delete `projects/unify-query-operations/`. Scope: `docs/architecture docs/adrs/`, project-folder deletion. Linear: TML-2354 (no sub-issue). Depends on: slice 4 (the ADR documents the as-shipped state).

## Dependencies (external)

None. Every change is internal: contract format, descriptor shape, and registry API are unchanged (per spec § Non-goals). No external infra, library bumps, or cross-team coordination.

- [ ] _None._

## Project-DoD coverage map

Project-DoD conditions are derived from the spec's `Acceptance Criteria` (AC1–AC13).

| Project-DoD | Delivered by |
| --- | --- |
| **AC1.** Legacy surfaces (`COMPARISON_METHODS_META`, `BuiltinFunctions`, `createBuiltinFunctions`) gone from production code. | Slice 3 |
| **AC2.** Family registers via the standard `queryOperations()` contributor surface; no separate code path. | Slice 2 |
| **AC3.** Trait gating symmetric: `fns.eq(cipherstashColumn, …)` fails type-check; `fns.like(textCol, textCol)` typechecks. | Slice 3 |
| **AC4.** Per-column ORM method surface unchanged (modulo the cipherstash tightening from AC3). | Slice 3 |
| **AC5.** `fns.<name>` calls valid before remain valid after (cipherstash tightening aside). | Slice 3 |
| **AC6.** `isNull`/`isNotNull` reachable on every codec via `self: { any: true }`; registration validator accepts the new arm and rejects ambiguous combinations. | Slice 1 (validator) + Slice 2 (factory entries) + Slice 3 (accessor reads) |
| **AC7.** No backward-compat shims; demo/examples updated in the same change as the deletion; `pnpm lint:deps` passes. | Slice 3 (deletions) + Slice 5 (close-out audit) |
| **AC8.** HAVING surface derived, not hand-listed; `HavingComparisonMethods<T>` deleted; numeric aggregate surface widens to include `in | notIn | isNull | isNotNull` and excludes `like`. | Slice 4 |
| **AC9.** End-to-end ORM query still builds and emits byte-identical SQL. | Slice 3 (integration tests pass unmodified) |
| **AC10.** New ADR drafted, supersedes ADR 203 / ADR 206 carve-outs. | Slice 5 |
| **AC11.** Family contract emission picks up family operation types into `QueryOperationTypes`; `asc`/`desc` not present there. | Slice 2 (emitter wiring) + Slice 3 (orderBy registry stays private) |
| **AC12.** Binary operator signatures gate by trait and tie operands (codec-id generic constrained to the relevant trait's codec-id union). | Slice 2 (factory authoring) + Slice 3 (consumers expose the new shapes) |
| **AC13.** `orderBy` / WHERE accessor split — `m.intField.asc()` works inside `orderBy`; `m.intField.asc` is absent in `where`; `fns.asc` does not exist. | Slice 3 |

Every AC has at least one delivering slice. Slices 1, 2, and 4 each have a unique AC anchor; slice 3 carries the lion's share because it's where the user-visible unification actually happens; slice 5 is the documentation close-out.

## Risks + open questions

1. **Slice 3 size.** This slice deletes two legacy types, collapses two consumers, splits the orderBy accessor, and tightens cipherstash trait gating — all in one atomic change. The split is necessary because FR11 forbids backward-compat shims, and any intermediate state would either leak both surfaces simultaneously (asymmetric trait gating still in flight) or require a feature flag (forbidden). If review feedback judges the slice too large, the contingency is to split the orderBy-accessor work into a follow-up slice 3b, accepting a transient "WHERE accessor still has `.asc/.desc` leak" state until 3b lands. Resolve at slice-pickup time via `drive-plan-slice`.
2. **Family-as-contributor wiring.** The current `createExecutionContext` contributors list is `[stack.target, stack.adapter, ...stack.extensionPacks]` — the family descriptor is not in it. Slice 2 must extend this to also pull `queryOperations()` from the family pack. The exact wiring (add `stack.family`? lift `SqlStaticContributions` onto `RuntimeFamilyDescriptor`? pass family separately to `createExecutionContext`?) is an implementer-degree-of-freedom call but affects ergonomics for every downstream caller of `createExecutionContext`. Worth a brief design check at slice-pickup time.
3. **`Functions<QC>` type-check time (NFR2).** Removing the `BuiltinFunctions<CT> &` intersection in favour of a single derived map could regress type-check time on the demo. The hot path is the `fns.eq(...)` resolution through `DeriveExtFunctions`. Mitigation: run `pnpm typecheck` before/after on the demo + an integration target; if regression > a few percent, investigate shared `infer` slots or distributive conditionals before shipping.
4. **HAVING widening (slice 4).** The HAVING surface on numeric aggregates picks up `in | notIn | isNull | isNotNull` that weren't there before. The spec calls this "deliberate, documented widening" — but downstream users of the demo / examples may have type-tests that assert the narrower set. Slice 4 must touch any such tests, not just leave them failing.
5. **Single tracking issue, no sub-issues.** All five slices land against TML-2354. Each slice PR must reference TML-2354 (in title or body) so the GitHub-Linear integration links the merge to the issue. The issue does not auto-close on the first merged PR — close manually only after slice 5 (close-out) lands, or rely on the integration's terminal-state transition rules for the team. Confirm the team's convention at execution-start.

## Close-out (required)

- [ ] Verify all acceptance criteria in `projects/unify-query-operations/spec.md` (AC1–AC13)
- [ ] Mandatory final retro complete; output landed in canonical / project-context / ADR
- [ ] Migrate long-lived docs into `docs/` (none expected beyond the new ADR — confirm at close-out)
- [ ] Strip repo-wide references to `projects/unify-query-operations/**` (replace with `docs/architecture docs/adrs/ADR NNN ...` links or remove)
- [ ] Delete `projects/unify-query-operations/`
- [ ] TML-2354 closed (via PR merge auto-transition or manual close after slice 5 lands)
