# Explicit namespace-aware DSL/ORM

## Summary

Reshape the ORM/SQL builder surface so namespace selection is always explicit (`orm.<ns>.<Model>`, `sql.<ns>.<table>`), removing the flat default-namespace fallback at the builder layer. Project the unified `db` facade per target descriptor: qualified shape for multi-namespace targets (Postgres), unbound-aliased flat shape for single-namespace targets (SQLite, Mongo). Success = `db` exposes the right shape on each of the three concrete targets in the repo, a multi-namespace fixture is queryable end-to-end, and the design is captured in a long-lived ADR.

**Spec:** [`../spec.md`](../spec.md)

**Linear:** [TML-2816](https://linear.app/prisma-company/issue/TML-2816/always-qualified-namespace-aware-dslorm-surface-ormnsmodel-sqlnstable)

## Collaborators

| Role | Person/Team | Context |
| --- | --- | --- |
| Maker | Serhii Tatarintsev | Assignee on TML-2816 |
| Hard prerequisite | TML-2605 author | Runtime identifier-qualification machinery this project consumes; must be merged before M1 begins |
| Reviewer | Terminal team (PR review) | Architectural review of builder/facade surface; ADR review |
| Collaborator | _TBC_ | Anyone owning downstream consumers that bypass the facade and use `orm` / `sql` directly on multi-namespace contracts |

## Shipping Strategy

The change is a deliberate breaking reshape of the **builder layer** (`orm`, `sql`): flat default-namespace accessors are removed; namespace selection becomes mandatory. The original plan called for a single PR on the reasoning that a *simultaneous* add-and-remove leaves main broken between merges. That reasoning only binds the simultaneous shape — an **additive-then-cut** sequencing splits the work into two slices that each merge to main green, with the breaking removal isolated to the second:

| Slice | PR | Merges to main | Delivers |
|---|---|---|---|
| [`slices/01-additive-namespaced-surface`](../slices/01-additive-namespaced-surface/spec.md) | PR1 | green (flat surface retained alongside namespaced) | AC1, AC2, AC6 — the namespaced surface added end-to-end and proven on PGlite |
| [`slices/02-remove-flat-fallback`](../slices/02-remove-flat-fallback/spec.md) | PR2 | green (breaking, coherent) | AC3, AC4, AC5, AC7 — flat removal + `defaultNamespaceId`-keyed facade projection + ADR |

The transient cost is a short-lived dual-shape window on the builder layer between PR1 and PR2 (both flat and namespaced present). The spec lists the flat fallback as a non-goal of the *end state*, so the additive transitional shape is consistent with intent. **F1 watch** (`drive/calibration/failure-modes.md`): the PR2 removal must delete the flat fallback outright, not relocate it under a new name.

> **AC placement nuance.** AC4 ("flat `db.<table>` absent on postgres") and AC5 (exclusive projection) assert the *absence* of the flat shape, so they can only fully verify in PR2 after the builder-layer flat surface is removed — even though the namespaced surface is reachable through the facade already in PR1.

End-user impact is bounded by the facade:

- **Single-namespace targets** (SQLite, Mongo): the facade aliases `db = orm.__unbound__` (and analogously for `db.sql`). User call sites (`db.<Model>`, `db.sql.<table>`) keep working without edits.
- **Multi-namespace targets** (Postgres): the facade exposes the qualified shape directly. User call sites must qualify (`db.<ns>.<Model>`, `db.sql.<ns>.<table>`). This is the deliberate breaking change.

Implicit gate: the facade's `defaultNamespaceId === UNBOUND_NAMESPACE_ID` discriminator. There is no feature flag; the breaking change is atomic at merge time. Upgrade instructions are recorded alongside the breaking-change PR per the `record-upgrade-instructions` skill, so downstream Postgres consumers can mechanically qualify their call sites.

Hard prerequisite: [TML-2605](https://linear.app/prisma-company/issue/TML-2605) (runtime-qualification) must be merged before M1 begins. This project reuses its identifier-qualification helpers; it does not re-implement them.

Release reaches users on the next NPM release-train cut. The wait between merge and publication is a task inside M2, not a separate Deploy slice.

## Test Design

| AC | TC | Test Case | Type | Slice | Expected Outcome |
| --- | --- | --- | --- | --- | --- |
| AC-1 | TC-1 | Multi-namespace contract where `auth.users` and `public.users` both exist: `sql.public.users` and `sql.auth.users` resolve and execute against distinct tables | Integration (PGlite) | M1 | Both queries succeed; emitted SQL contains `"public"."users"` vs `"auth"."users"` |
| AC-1 | TC-2 | Explicit SQL accessor supports the same builder operations (select / insert / update / delete) as the previously flat path | Integration | M1 | All four operation kinds execute through the qualified accessor and return expected results |
| AC-2 | TC-3 | `orm.public.User.find` and `orm.auth.User.find` resolve to the correct namespace's model accessor | Integration | M1 | Find / create / update / delete on both namespaces return correct rows |
| AC-2 | TC-4 | ORM namespace keys equal SQL namespace keys for the same contract | Type-level | M1 | `keyof typeof orm === keyof typeof sql` on a multi-namespace fixture |
| AC-4 | TC-7 | Postgres facade: `db.public.User.find` executes against `"public"."users"` | Integration | M1 | Qualified path returns expected rows |
| AC-4 | TC-8 | Postgres facade: `db.sql.public.users.select` executes against `"public"."users"` | Integration | M1 | Qualified SQL builder path returns expected rows |
| AC-4 | TC-9 | SQLite facade: `db.User.find` works (aliased to `orm.__unbound__.User`) | Integration | M1 | Existing SQLite test fixtures pass without call-site changes |
| AC-4 | TC-10 | SQLite facade: `db.sql.users` works (aliased to `sql.__unbound__.users`) | Integration | M1 | Existing SQLite SQL-DSL fixtures pass without call-site changes |
| AC-4 | TC-11 | Mongo facade: `db.<Model>` works (aliased to `orm.__unbound__`) | Integration | M1 | Existing Mongo test fixtures pass without call-site changes |
| AC-5 | TC-12 | Facade projection helper has no per-target switch | Static (grep + code review) | M1 | No `switch (targetId)` / `if (familyId === ...)` in facade construction; single shared helper dispatches purely on `defaultNamespaceId` |
| AC-5 | TC-13 | Type-level: a target pack with `defaultNamespaceId: 'public'` yields a qualified `Db<C>`; a pack with `'__unbound__'` yields a flat `Db<C>` | Type-level | M1 | Asserted against Postgres pack, SQLite pack, Mongo pack |
| AC-6 | TC-14 | Multi-namespace PSL fixture (two namespaces + cross-namespace FK) parses; emits `contract.json` with both `domain.namespaces` and `storage.namespaces` keyed by namespace id; round-trips through `validateContract` | Integration | M1 | Contract IR matches expected shape; FK references the correct cross-namespace coordinate |
| AC-6 | TC-15 | Same fixture queryable end-to-end via PGlite using explicit accessors, including the FK-mediated relation | Integration (PGlite) | M1 | Cross-namespace join returns expected rows |
| AC-7 | TC-16 | ADR exists under `docs/architecture docs/adrs/` covering (a) always-qualified builder surface, (b) facade-aliasing pattern, (c) `Db<C>` per-namespace facet construction | Doc review | M2 (drafted in M1; migrated in M2) |
| AC-8 | TC-17 | `pnpm test:packages` green on the merge candidate | Harness | M1 |
| AC-8 | TC-18 | `pnpm lint:deps` green on the merge candidate | Harness | M1 |
| FR-7 | TC-19 | `contract.json` shape unchanged for an existing single-namespace fixture (snapshot regression) | Integration / snapshot | M1 | Snapshot diff is empty for `packages/**/test/__snapshots__/contract.json.*` representing pre-change fixtures |
| FR-10 | TC-20 | Explicit accessors invoke the TML-2605 identifier-qualification helper rather than a parallel pipeline | Static (code review + grep) | M1 | Per-namespace facet construction imports the same qualification helper as TML-2605's emit path; no duplicate qualifier implementation in this project's diff |
| FR-11 | TC-21 | Unknown namespace id passed at runtime (contract widened from JSON) fails fast with a diagnostic naming the namespace | Integration | M1 | Thrown error mentions the offending namespace id |

## Slices

### Implement M1: Always-qualified builders and per-target facade projection

_Outcomes_
The framework's `orm` and `sql` builder surfaces expose per-namespace facets only — flat default-namespace accessors are gone. The unified `db` facade projects per target descriptor: Postgres requires qualified call sites, SQLite and Mongo preserve the flat `db.<Model>` / `db.sql.<table>` shape via `db = orm.__unbound__` aliasing. A multi-namespace fixture is queryable end-to-end on Postgres/PGlite; single-namespace integration tests pass on SQLite and Mongo without call-site edits. ADR is drafted (still inside `projects/explicit-namespace-dsl/`). `pnpm test:packages` and `pnpm lint:deps` are green on the merge candidate.

**Tasks:**

- [ ] Move TML-2816 to In Progress
- [ ] **Builder reshape (rename-and-map).** The existing `Db<C>` shape (currently a flat map of model/table accessors) becomes the **content of a single namespace** — rename to `Namespace<C, NsId>` (or equivalent). The new `Db<C>` is a mapped type over `contract.<plane>.namespaces`: `{ [Ns in keyof contract.namespaces]: Namespace<C, Ns> }`. Apply the same rename-and-map pattern symmetrically to the ORM and SQL builder types. Result: per-namespace facets fall out of the construction; the flat shape is structurally impossible to reintroduce. (satisfies: TC-4)
- [ ] **Runtime resolution wiring.** Per-namespace accessors delegate to the TML-2605 identifier-qualification helper, parameterized by namespace coordinate — no parallel qualifier. Fail-fast diagnostic when a runtime-widened contract carries an unknown namespace / table / model name; message names the offending namespace. (satisfies: TC-20, TC-21)
- [ ] **Facade projection.** Single shared helper keyed on `defaultNamespaceId === UNBOUND_NAMESPACE_ID`: when unbound, alias `db = orm.__unbound__` and `db.sql = sql.__unbound__`; otherwise expose `db = orm` and `db.sql = sql` directly. Wire into the Postgres facade (`packages/3-targets/3-targets/postgres`), SQLite facade (`packages/3-targets/3-targets/sqlite`), and Mongo facade (`packages/3-mongo-target/1-mongo-target`) using the same helper — no per-target switch. (satisfies: TC-12, TC-13)
- [ ] **Integration test pass — multi-namespace path on Postgres.** Author a multi-namespace PSL fixture (`public.Profile` + `auth.User` + cross-namespace FK). Emit `contract.json`; assert IR shape; query via `sql.public.profile`, `sql.auth.users`, `orm.public.Profile`, `orm.auth.User` against PGlite; exercise the FK relation. Cover select / insert / update / delete via the qualified accessor. Also exercise the Postgres facade (`db.public.User.find`, `db.sql.public.users.select`). (satisfies: TC-1, TC-2, TC-3, TC-7, TC-8, TC-14, TC-15)
- [ ] **Integration test pass — single-namespace facade-alias path.** SQLite: `db.<Model>` and `db.sql.<table>` resolve through `orm.__unbound__` / `sql.__unbound__` and execute correctly on existing single-namespace fixtures. Mongo: analogous coverage on the Mongo ORM surface. (satisfies: TC-9, TC-10, TC-11)
- [ ] **Regression snapshot.** Confirm `contract.json` shape is byte-identical for an existing single-namespace fixture (no emitter changes leaked into this project). (satisfies: TC-19)
- [ ] **Record upgrade instructions** per the `record-upgrade-instructions` skill for the builder-layer flat-accessor removal. Scope: downstream consumers (extension packs, example apps) that call `orm.<Model>` or `sql.<table>` directly on a multi-namespace contract — they must qualify. Single-namespace consumers using the `db` facade need no changes.
- [ ] **Draft ADR** in `projects/explicit-namespace-dsl/` covering (a) always-qualified builder surface, (b) facade-aliasing pattern keyed on `defaultNamespaceId`, (c) `Db<C>` per-namespace facet construction. Cross-link to TML-2605 and to the per-target facade wiring sites. (drafts TC-16; final-form migration happens in M2)
- [ ] **Validation gate.** `pnpm typecheck`, `pnpm test:packages`, `pnpm lint:deps` green on the merge candidate. (satisfies: TC-17, TC-18)

### Release M2: Feature in users' hands; project closed out

_Outcomes_
The change is published to NPM via the next release-train cut and reaches users on `latest`. The ADR lives in its long-lived home under `docs/architecture docs/adrs/`. All acceptance criteria are verified against the merged PR. `projects/explicit-namespace-dsl/` no longer exists in the repo.

**Tasks:**

- [ ] **Migrate ADR** from `projects/explicit-namespace-dsl/` to `docs/architecture docs/adrs/` with the next available ADR number; update any in-code or in-docs cross-references to the project path to point at the new ADR location. (satisfies: TC-16)
- [ ] **Verify all acceptance criteria** are met against the merged PR (AC1–AC8 in `projects/explicit-namespace-dsl/spec.md`); link each to its TC evidence (test files, snapshot, ADR location).
- [ ] **Cut / await the next NPM release train.** Once the framework + target packages publish, confirm the change is present in the published `@prisma-next/*` versions on `latest` (per `publish-npm-version` skill).
- [ ] **Close-out:** delete `projects/explicit-namespace-dsl/`; move TML-2816 to Done.

## Open Items

- **ORM query-execution path not multi-namespace-aware (discovered slice 01 D2).** `collection-contract.ts`'s `modelsOf()` → `domainModelsAtDefaultNamespace()` throws on any multi-namespace contract. **Resolved — operator chose (a):** folded into slice 01 as a new additive dispatch (ORM execution namespace-awareness, local to `sql-orm-client`); project stays 2 PRs, PR1 is heavier. See `slices/01-additive-namespaced-surface/{spec,plan}.md` (Dispatch 3).
- **Collaborator / reviewer naming.** Spec does not name specific reviewers; left as TBC until M1 starts. Downstream-consumer collaborator likewise TBC pending upgrade-instructions-scope review.
- **Upgrade-instructions scope.** Working assumption: only downstream consumers that call `orm` / `sql` directly on multi-namespace contracts are affected; facade users (`db.<Model>`) are unaffected. Reviewer to confirm at PR time; widen the upgrade instructions if internal extension packs (`packages/3-extensions/*`) surface additional bypass sites.
- **Type-inference cost (NFR2).** If the per-namespace facet pattern strains TypeScript inference on realistic contract sizes, the ADR records the mitigation (e.g. lazy expansion of the namespace map). Re-evaluate during M1 if compile times regress noticeably.
- **TC-20 verification mode.** Listed as code review + grep against the project diff. If a structural test (e.g. an import-graph assertion) is feasible at low cost, prefer that over manual review.
