# Extension Contract Spaces — Project Plan

## Summary

Introduce **contract spaces** — disjoint `(contract.json, migration-graph)` units that the framework treats uniformly — so extensions become first-class schema contributors using the same planner, runner, verifier, and migration shape as application authoring. As part of the project, the in-tree workspace extension that uses `databaseDependencies.init` (pgvector — confirmed sole consumer by spike) is migrated to a contract space; cipherstash is authored fresh on the new mechanism. arktype-json is out of scope (spike confirmed it ships no `databaseDependencies` and needs no DB scaffolding). After both extensions ship, the `databaseDependencies` mechanism is removed. The cipherstash blocker (TML-2373) is unblocked by M3.

**Spec:** `projects/extension-contract-spaces/spec.md`

**Sub-specs:**
- `specs/framework-mechanism.spec.md` — drives M1 + M2.
- `specs/cipherstash-migration.spec.md` — drives M3.

## Collaborators

| Role         | Person/Team                          | Context                                                           |
| ------------ | ------------------------------------ | ----------------------------------------------------------------- |
| Maker        | William Madden                       | Drives execution                                                  |
| Reviewer     | William Madden                       | Architectural review across planner / runner / verifier           |
| Collaborator | Cipherstash project (TML-2373)       | Immediate consumer; needs the unblock                             |
| Collaborator | pgvector maintainers                 | pgvector is migrated to a contract space under M4                 |

## Shipping Strategy

Every milestone is safe to deploy immediately because the contract-space mechanism is **additive** until M5. The implicit gate between old and new behaviour is the presence of the `contractSpace` field on an extension descriptor:

- If an extension descriptor does not expose `contractSpace`, it falls back to the existing `databaseDependencies.init` path (M1-M4).
- If an extension descriptor exposes `contractSpace`, the framework loads it; any `databaseDependencies` entry the same descriptor still carries is ignored.
- M5 removes `databaseDependencies` only after every in-tree extension has migrated — by then the field is unused everywhere.

The marker schema gains a `space` column with a one-shot framework-internal migration that promotes the existing single-row marker to `(space='app', …)` shape. The migration is idempotent; deployments mid-rollout see no semantic change. No feature flags are required.

## Sub-specs

Two milestones have task specs because their implementation detail is large enough to crowd the project plan:

- [`specs/framework-mechanism.spec.md`](./specs/framework-mechanism.spec.md) — locks down API shapes for the per-space planner / runner / verifier, the `contractSpace` extension-descriptor field, the marker schema migration SQL, the pinned per-space artefact layout + canonicalisation rules, the codec lifecycle hook, and the per-space `db init` / `db update` flows. Drives M1 and M2.
- [`specs/cipherstash-migration.spec.md`](./specs/cipherstash-migration.spec.md) — locks down cipherstash's package layout, contract IR contents, baseline migration shape (with the EQL bundle byte-equivalence rule), codec hook behaviour, descriptor wiring, and four end-to-end test scenarios (initial, drop, bump, revert workaround). Drives M3.

M4 (pgvector + monorepo example) and M5 (`databaseDependencies` removal + close-out) are small enough to be captured inline in this plan; no task spec needed.

## Test Design

Test cases derived from each acceptance criterion in the spec. Tasks reference these test cases.

| AC    | TC    | Test Case                                                                                                                       | Type        | Milestone | Expected Outcome                                                                                       |
|-------|-------|---------------------------------------------------------------------------------------------------------------------------------|-------------|-----------|--------------------------------------------------------------------------------------------------------|
| AC-1  | TC-1  | Fresh Postgres + cipherstash-as-contract-space → `dbInit` strict mode succeeds                                                  | Integration | M3        | dbInit returns success; verifier sees `eql_v2_*` objects as expected                                   |
| AC-1  | TC-2  | After TC-1 setup, hand-add unexpected column to `eql_v2_configuration` → `dbInit` fails                                         | Integration | M3        | dbInit fails with strict-mode error; clear remediation hint                                            |
| AC-2  | TC-3  | User schema with cipherstash + Encrypted<string,searchable> column → `migrate` produces app-space migration directory at root   | Integration | M3        | Directory at `migrations/<timestamp>_*/` with structural ops + codec-emitted `add_search_config` op    |
| AC-2  | TC-4  | Same setup → `migrate` produces cipherstash-space migration directory under `migrations/cipherstash/`                           | Integration | M3        | Directory under `migrations/cipherstash/<original-name>/`                                              |
| AC-2  | TC-5  | After TC-3/4, `db apply` runs both migrations in single transaction                                                              | Integration | M3        | Both migrations apply atomically; either both succeed or neither                                       |
| AC-2  | TC-6  | After TC-5 apply, marker table has 2 rows                                                                                       | Integration | M3        | Marker has rows for `app` and `cipherstash` with expected hashes                                       |
| AC-3  | TC-7  | Bump cipherstash, run `migrate` → only new ops in cipherstash-space migration                                                   | Integration | M3        | New cipherstash-space migration contains only the new op; prior invariantIds skipped via marker        |
| AC-4  | TC-8  | Monorepo example with 2 internal contract owners + aggregator → builds, emits per-space, applies                                | Integration | M4        | All per-space migrations applied; marker has rows per package                                          |
| AC-5  | TC-9  | After multi-space apply, integration test asserts marker row set + hash equality                                                | Integration | M3        | Marker row count = number of loaded spaces; each row's hash matches contract.json content              |
| AC-5  | TC-10 | Vary `extensionPacks` declaration order, verify aggregate is identical                                                          | Integration | M1        | Aggregate hash byte-equal regardless of declaration order                                              |
| AC-6  | TC-11 | Runner does not import extension descriptor module during apply path                                                            | Integration | M3        | Static analysis or runtime tracing confirms no descriptor import during apply                          |
| AC-7  | TC-12 | Cipherstash extension's `installEqlBundle` op contains vendored bundle SQL byte-for-byte                                        | Unit        | M3        | Op body equals the vendored bundle file's contents                                                     |
| AC-8  | TC-13 | Cipherstash's `contract.json` contains the typed objects but not the opaque ones                                                | Unit        | M3        | Contains `eql_v2_encrypted`, `eql_v2_configuration_state`, domains; does NOT contain functions / operators / casts |
| AC-9  | TC-14 | Drop searchable Encrypted column → codec hook emits `remove_search_config` in app-space migration; cipherstash marker unchanged | Integration | M3        | App-space migration carries `remove_search_config`; cipherstash marker row hash unchanged              |
| AC-10 | TC-15 | pgvector contract space declares `vector` type                                                                                  | Unit        | M4        | pgvector's `contract.json` declares `vector` type                                                      |
| AC-10 | TC-16 | User adds pgvector + `vector(N)` column → `migrate` + `apply` succeeds; marker has 2 rows                                       | Integration | M4        | Marker has rows for `app` and `pgvector` with expected hashes                                          |
| AC-10 | TC-17 | dbInit on resulting database succeeds in strict mode                                                                            | Integration | M4        | Strict-mode dbInit returns success                                                                     |
| AC-11 | TC-19 | `ComponentDatabaseDependencies` and `databaseDependencies` removed from framework + pgvector                                     | Build       | M5        | Build fails if any reference remains; rg returns no consumer matches                                   |
| AC-12 | TC-21 | Fresh database with cipherstash → `db init` walks cipherstash graph + synthesizes app-space delta in single transaction         | Integration | M3        | Single transaction; marker rows for both spaces with expected hashes                                   |
| AC-13 | TC-22 | User removes extension while marker row remains → `dbInit` fails with orphan-row error and remediation hint                     | Integration | M1        | Clear error identifying orphan row + recommended manual cleanup                                        |
| NFR1  | TC-23 | `strictVerification: false` workaround removed from cipherstash-related test setups                                             | Build/Lint  | M3        | grep returns no matches in cipherstash tests / examples                                                |
| NFR5  | TC-24 | Benchmark emit + dbInit performance with 0 vs 1 extensions                                                                      | Integration | M5        | < 5% wall-clock overhead delta                                                                         |
| AC-14 | TC-25 | Bump cipherstash → `migrate` produces PR diff with updated pinned files + new migration directory                               | Integration | M3        | Pinned `migrations/cipherstash/{contract.json,contract.d.ts,refs/head.json}` updated; new migration dir |
| AC-15 | TC-26 | Delete `node_modules/<extension>` then run `dbInit` + `db apply` → both succeed reading pinned files only                       | Integration | M1        | Verifier + runner succeed; no descriptor import attempted on either path                               |
| AC-16 | TC-27 | Add extension to `extensionPacks` without running `migrate` → `dbInit` fails with declared-but-unmigrated error                 | Integration | M1        | Clear error naming the extension + remediation `prisma-next migrate`                                   |
| AC-16 | TC-28 | `migrations/<space-id>/` exists on disk for extension not in `extensionPacks` → `dbInit` fails with orphan-pinned-dir error     | Integration | M1        | Clear error identifying orphan dir + remediation                                                       |
| AC-2  | TC-29 | After `migrate` with cipherstash declared, pinned `migrations/cipherstash/{contract.json,contract.d.ts,refs/head.json}` exist  | Integration | M3        | Files exist; byte-equivalent to descriptor's current values via canonicalization                       |
| FR-17 | TC-30 | Bump descriptor's `contractJson` without running `migrate` → next `migrate` invocation surfaces drift warning before emitting   | Unit        | M1        | Drift detection emits a clear "extension bumped — run migrate to materialise" message                  |

Decision/spike tasks (resolved during plan finalisation):

- ~~T4.4~~ — arktype-json scope spike. **Resolved**: arktype-json ships no `databaseDependencies` (jsonb is built-in); no contract space needed. Dropped from scope.

## Milestones

### Milestone 1: Framework — contract space mechanism

Introduce the framework's per-space planner/runner/verifier and the extension descriptor's `contractSpace` field. Existing in-tree extensions remain on `databaseDependencies.init` and continue to work unchanged (additive change). The new code path is exercised by a synthetic test extension end-to-end.

**Tasks:**

- [ ] **T1.1** Marker schema migration: add `space` column (text, not null), change PK from `id` to `space`, write a one-shot framework-internal migration that promotes existing single-row markers to `(space='app', …)`. Must be idempotent and shadow-DB preflight-validated. (supports: TC-9, TC-10, TC-22, and many later TCs)
- [ ] **T1.2** Add `contractSpace?: { contractJson, migrations, headRef }` field to extension descriptor types. (satisfies: TC-3, TC-4)
- [ ] **T1.3** Per-space planner: extend the SQL-family planner to accept a list of (space, contract) tuples; default behaviour for existing single-app code paths preserved when no extension exposes `contractSpace`. (satisfies: TC-3, TC-4, TC-10)
- [ ] **T1.4** Per-space runner: extend the SQL-family migration runner to support per-space marker rows with cross-space ordering convention (extensions first, app-space second); single transaction across spaces. The runner reads only from the user's repo (no descriptor import). (satisfies: TC-5, TC-21, TC-26)
- [ ] **T1.5** Per-space verifier: aggregate per-space contracts by reading the user's repo (root-level app-space `contract.json` + each loaded extension's pinned `migrations/<space-id>/contract.json`). Deterministic alphabetical-by-space-id sort. Per-space hash check. Three orphan / missing checks with clear remediation hints: (a) marker rows for spaces not in `extensionPacks`, (b) `extensionPacks` entries with no pinned contract on disk, (c) `migrations/<space-id>/` directories on disk for spaces not in `extensionPacks`. No descriptor import on this path. (satisfies: TC-9, TC-10, TC-22, TC-26, TC-27, TC-28)
- [ ] **T1.6** Per-space layout convention (γ): emit migrations under `migrations/<space-id>/<migration-name>/` for extension spaces; root for app-space. Update emitter to choose target directory by space. (satisfies: TC-3, TC-4)
- [ ] **T1.7** Migration package emission helper: serialize an in-memory `MigrationPackage` (manifest + ops + contract.json snapshot) to per-space subdirectory; canonicalized for byte-determinism. (satisfies: TC-3, TC-4)
- [ ] **T1.8** Pinned per-space artefact emission: on every `migrate`, write (or overwrite) `migrations/<space-id>/contract.json`, `migrations/<space-id>/contract.d.ts`, `migrations/<space-id>/refs/head.json` from each loaded extension's descriptor `contractSpace` values. Canonicalised for byte-determinism. (satisfies: TC-25, TC-29)
- [ ] **T1.9** Drift detection at `migrate` time: compare descriptor's current `contractJson` against the on-disk pinned version; if diverged but no new migrations are being emitted (e.g. user bumped a non-changing extension), surface a clear warning. (satisfies: TC-30)
- [ ] **T1.10** Synthetic test extension at `packages/3-extensions/test-contract-space/` (private workspace package, mirrors pgvector's package shape — package.json, tsdown, vitest, src/exports/control.ts). Declares one composite type, one baseline migration, one head ref. Used as scaffolding for later milestones' E2E tests; exercises the same module-graph descriptor-import path a real extension would use. Includes a "deletable node_modules" test fixture that exercises TC-26.

**Validation gate:**

- `pnpm typecheck`
- `pnpm test:packages`
- `pnpm test:integration`
- `pnpm lint:deps`
- `pnpm build`

### Milestone 2: Framework — codec lifecycle hook + db init/update per-space

Introduce the codec lifecycle hook and refactor `db init` / `db update` to be per-space `findPathWithDecision` applications. Still no in-tree extension uses these; the synthetic test extension from M1 exercises them.

**Tasks:**

- [ ] **T2.1** Codec lifecycle hook API: extend `CodecControlHooks` with `onFieldEvent(event, ctx) => MigrationOp[]`. Triggered events: `'added'`, `'dropped'`, `'altered'` (where `'altered'` = any field property changed except `codecId`). Synchronous; receives prior + new IR for the table containing the changed field, app-space scope only. (satisfies: TC-14)
- [ ] **T2.2** Wire codec lifecycle hook into the application emitter's per-field diff logic; capture returned ops into the app-space migration's `ops.json`, alongside the user's structural ops. (satisfies: TC-14)
- [ ] **T2.3** db init per-space: extend the in-memory edge synthesis to be per-space-aware. App-space synthesizes from contract; extension-space walks the migration graph from current marker → headRef.hash via `findPathWithDecision`. Concatenate per cross-space ordering; single transaction. (satisfies: TC-21)
- [ ] **T2.4** db update per-space: same as T2.3 but for `db update` (advance current marker → headRef.hash per space). (satisfies: TC-21)
- [ ] **T2.5** Extend the synthetic test extension from T1.10 to exercise the codec hook + per-space db init/update.

**Validation gate:**

- `pnpm typecheck`
- `pnpm test:packages`
- `pnpm test:integration`
- `pnpm lint:deps`
- `pnpm build`

### Milestone 3: Migrate cipherstash to contract space

Migrate the cipherstash extension to a contract space, unblocking TML-2373. Cipherstash's `databaseDependencies.init` is removed; the `strictVerification: false` workaround is reverted.

A task spec at `specs/cipherstash-migration.spec.md` captures the implementation detail (precise contract-space contents, baseline migration shape, codec hook behaviour, E2E test design).

**Tasks:**

- [ ] **T3.1** Author cipherstash's contract space contents: PSL/TS for `eql_v2_configuration` table, `eql_v2_encrypted` composite, `eql_v2_configuration_state` enum, `eql_v2.bloom_filter` / `hmac_256` / `blake3` domains, `ore_*` composites. Emit `contract.json`. (satisfies: TC-13)
- [ ] **T3.2** Author cipherstash's baseline migration: `installEqlBundle` op containing the vendored 5,750-line bundle SQL byte-for-byte + create-eql_v2_configuration op + create-type ops; each carrying `cipherstash:*` invariantIds. (satisfies: TC-1, TC-12)
- [ ] **T3.3** Author cipherstash's `headRef` declaring the current target hash + `cipherstash:*` invariants set. Wire descriptor module to expose `contractSpace`. (satisfies: TC-1)
- [ ] **T3.4** Implement codec lifecycle hook for `cipherstash:string@1`: emit `add_search_config` op on field-added(searchable: true), `remove_search_config` on field-dropped(searchable: true), and rotate-search-config on altered (searchable flip / typeParams change). Each op carries `cipherstash-codec:*` invariantId. (satisfies: TC-14)
- [ ] **T3.5** Remove cipherstash's `databaseDependencies.init` from its descriptor. (satisfies: TC-1)
- [ ] **T3.6** End-to-end integration test: user schema with `Encrypted<string>` searchable column + cipherstash → `migrate` → `apply` → query. Live Postgres + EQL. Asserts directory layout, pinned per-space artefacts (`migrations/cipherstash/{contract.json,contract.d.ts,refs/head.json}`), marker rows, transactional apply, codec ops. (satisfies: TC-1 through TC-7, TC-11, TC-21, TC-29)
- [ ] **T3.7** Bump-cipherstash test: simulate cipherstash version bump (e.g. test fixture with two descriptor versions); run `migrate` against a project pinned at vX with vY now installed. Assert pinned files updated in place + new migration directory created. (satisfies: TC-25)
- [ ] **T3.8** Revert `strictVerification: false` workaround in cipherstash test setups + examples. (satisfies: TC-23)
- [ ] **T3.9** Re-verify NFR1: dbInit strict mode runs end-to-end without the workaround.

**Validation gate:**

- `pnpm typecheck`
- `pnpm test:packages`
- `pnpm test:integration`
- `pnpm test:e2e` (cipherstash needs live Postgres + EQL)
- `pnpm lint:deps`
- `pnpm build`

### Milestone 4: Migrate pgvector + monorepo example

Migrate the only existing workspace consumer of `databaseDependencies` (pgvector) to a contract space. A monorepo example demonstrates the same mechanism applies to internal-package contract owners. arktype-json was investigated during plan finalisation and confirmed out of scope (no `databaseDependencies`, jsonb built-in, no contract space needed).

**Tasks:**

- [ ] **T4.1** Author pgvector's contract space contents: `vector` type (parameterized native type) declared in `contract.json`. Author baseline migration: `installVectorExtension` op carrying `CREATE EXTENSION IF NOT EXISTS vector` DDL + postcondition check; carries `pgvector:install-vector-v1` invariantId. (satisfies: TC-15)
- [ ] **T4.2** Wire pgvector descriptor's `contractSpace`; remove `databaseDependencies` from `packages/3-extensions/pgvector/src/exports/control.ts`. (satisfies: TC-15, TC-16, TC-17)
- [ ] **T4.3** End-to-end integration test for pgvector: user schema with `vector(N)` column → migrate → apply → query. Assert pinned `migrations/pgvector/{contract.json,contract.d.ts,refs/head.json}` are written with byte-equivalent content. (satisfies: TC-16, TC-17)
- [ ] **T4.4** Monorepo example: two internal packages each declare a contract space + an aggregator package depending on both. Build, emit per-space migrations, apply. (satisfies: TC-8)

**Validation gate:**

- `pnpm typecheck`
- `pnpm test:packages`
- `pnpm test:integration`
- `pnpm test:e2e`
- `pnpm lint:deps`
- `pnpm build`

### Milestone 5: Remove `databaseDependencies` mechanism + close-out

Remove the `databaseDependencies` mechanism from the framework. After M3 + M4 land, the only remaining consumer is gone (pgvector was the sole workspace consumer; cipherstash never used it). The blast radius is small — confirmed by spike: 3 files (the type def, the re-export, and pgvector's now-removed usage). Migrate finalised ADRs into `docs/`, strip transient project references, delete `projects/extension-contract-spaces/`.

**Tasks:**

- [ ] **T5.1** Remove `ComponentDatabaseDependencies` and `ComponentDatabaseDependency` types from `packages/2-sql/9-family/src/core/migrations/types.ts`. Remove the re-export from `packages/2-sql/9-family/src/exports/control.ts`. Remove the `databaseDependencies?` field from `SqlControlExtensionDescriptor`. Remove any planner / runner / verifier code paths that consume `databaseDependencies`. (satisfies: TC-19)
- [ ] **T5.2** Audit: `rg 'ComponentDatabaseDependencies|ComponentDatabaseDependency|databaseDependencies' packages/ examples/` returns zero matches. (satisfies: TC-19)
- [ ] **T5.3** New ADR — Contract spaces. Captures the design (per-space planner / runner / verifier, descriptor model, layout convention, pinned per-space artefacts, marker schema change, db init/update semantics).
- [ ] **T5.4** New ADR — Codec lifecycle hooks. Captures the hook contract (synchronous, app-space-bound, IR scope, altered semantics).
- [ ] **T5.5** Update ADR 154 — record supersession; mark `databaseDependencies` removed.
- [ ] **T5.6** Update ADR 021 — record marker schema gain of `space` column; PK change.
- [ ] **T5.7** Update subsystem docs: Migration System (per-space planner/runner/verifier; ADR 208 use in db init/update; pinned per-space artefact layout), Ecosystem Extensions & Packs (descriptor model; contract space authoring guide).
- [ ] **T5.8** NFR5 perf benchmark: emit + dbInit with 0 vs 1 extensions; assert < 5% delta. Capture results in `docs/`. (satisfies: TC-24)
- [ ] **T5.9** Close-out: migrate finalised ADRs into `docs/architecture docs/adrs/`. Strip references to `projects/extension-contract-spaces/` across the repo (replace with canonical `docs/` links). Delete `projects/extension-contract-spaces/`. PR title or branch references TML-2397 so Linear's GitHub integration auto-completes the issue on merge.

**Validation gate:**

- `pnpm typecheck`
- `pnpm test:all` (workspace-wide because we delete public API surfaces)
- `pnpm lint:deps`
- `pnpm build`
- `rg 'ComponentDatabaseDependencies|ComponentDatabaseDependency|databaseDependencies' packages/ examples/` returns no matches

## Open Items

Carrying forward from `spec.md` § Open Questions:

1. **`invariantId` namespacing convention.** Recommended default: prefix convention (`cipherstash:install-eql-v1`, `app:create-table-User-v1`, `cipherstash-codec:User.email@v1`). Alternative: structured records. Decide during M1 / M3 implementation; captured in `specs/framework-mechanism.spec.md` for M1 and `specs/cipherstash-migration.spec.md` for M3.
2. **Cipherstash project (TML-2373) integration path.** Whether the in-flight cipherstash project pivots to consume this mechanism, continues with its current band-aid until this lands, or pauses. Decision deferred to a separate conversation; not a plan-level question.

Plan-derived items needing resolution during execution:

3. **Marker schema migration safety.** T1.1 changes the marker table's primary key from `id` to `space`. This is a one-shot framework-internal migration; needs careful handling for deployments that may have multiple running processes. Verify via shadow-DB preflight (per ADR 029).

Resolved during plan finalisation:

- ~~**arktype-json's contract space shape.**~~ Spike (T4.4) confirmed: arktype-json ships no `databaseDependencies` and needs no DB scaffolding (jsonb is built-in). Dropped from scope.
- ~~**Synthetic test extension package location.**~~ Locked: `packages/3-extensions/test-contract-space/` as a private workspace package (mirrors pgvector's shape; exercises real descriptor-import path).
- ~~**Linear project elevation.**~~ Decision: keep TML-2397 as a single tracking issue (no Linear project / per-deliverable issues).
- ~~**Sub-spec timing.**~~ Decision: drafted now (alongside this plan). See `specs/framework-mechanism.spec.md` and `specs/cipherstash-migration.spec.md`.
- ~~**Reviewer assignment.**~~ William Madden (self-review on architectural decisions across planner / runner / verifier).
