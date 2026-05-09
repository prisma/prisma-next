# Walkthrough — PR #434 (TML-2397 M1, framework mechanism)

**Audience:** a human operator touring this multi-thousand-LOC PR — preparing to merge, give substantive feedback, or land a follow-up.
**Lens:** tech-lead persona (orchestration, altitude, surface conflicts, keep the user in the loop).
**Source-pinning:** scope is `origin/main..ee05b2b4f` (PR head ref at the time of this review). Sibling reviews and source files referenced below are pinned to `ee05b2b4f`.

## Sources

- **PR:** [#434 — (TML-2397) M1 — Contract spaces: framework mechanism](https://github.com/prisma/prisma-next/pull/434)
- **Linear:** [TML-2397](https://linear.app/prisma-company/issue/TML-2397)
- **Project spec (read at `ee05b2b4f`):** `projects/extension-contract-spaces/spec.md`
- **Sub-spec for M1+M2 (read at `ee05b2b4f`):** `projects/extension-contract-spaces/specs/framework-mechanism.spec.md`
- **Sibling reviews (this directory):**
  - [system-design-review.md](system-design-review.md) — architect lens (typology, naming, bounded contexts).
  - [code-review.md](code-review.md) — principal-engineer lens (failure modes, AC verification).
- **Commit range:** `origin/main..ee05b2b4f` — 31 commits; ~5,400 insertions, ~4,100 deletions across 193 files.

## Intent

Make extensions *first-class schema contributors* by replacing the `databaseDependencies.init` runtime escape hatch with **contract spaces** — disjoint `(contract.json, migration-graph, head-ref)` units the framework treats uniformly. M1 (this PR) lands the *framework primitives*: per-space planner, per-space concat-for-runner, per-space verifier, per-space emit-pinned-artefacts, per-space drift detector, and the descriptor surface that lets a SQL extension publish a contract space.

The application owns one space (`'app'`); each loaded extension owns a uniquely-named one. The user's repo is the integration boundary: every loaded extension's `contract.json` / `contract.d.ts` / `refs/head.json` and migration directories are *pinned on disk* under `migrations/<space-id>/`, so apply-time and verify-time can read the user repo only — `node_modules` is required at *authoring* time only.

M2–M5 (later PRs in the stack) consume this surface for per-space `db init`/`db update`, the cipherstash and pgvector migrations, and removal of `databaseDependencies.init`.

## The story

The PR does five conceptual moves; the rest is downstream consequences and round-of-review cleanups.

1. **Hoist contract-space identity into `framework-components/control`.** Two new types — `ContractSpace<TContract>` and `MigrationPackage` — plus the constant `APP_SPACE_ID` and the existing `MigrationMetadata` / `MigrationHints` (relocated from `migration-tools/src/metadata.ts`). The framework owns the cross-target identity types; the SQL family specialises `ContractSpace<Contract<SqlStorage>>` at the descriptor surface; Mongo will mirror later. **See [system-design-review.md § Bounded-context audit](system-design-review.md) for the layer-placement rationale.**
2. **Promote `prisma_contract.marker` from one row to N rows.** The marker schema gains a `space text primary key` column; brand-new databases create the per-space shape directly. Pre-1.0 single-row markers are detected and **rejected with `LEGACY_MARKER_SHAPE`** rather than auto-migrated — a deliberate M1-cleanup F2 choice. **The principal-engineer review surfaces operability concerns about the remediation hint — see [code-review.md § F02](code-review.md#f02-legacy_marker_shape-remediation-is-destructively-under-specified).**
3. **Land seven framework-neutral helpers in `migration-tools`** that the SQL family will wire up at the consumption site in M2:
   - `planAllSpaces` — deterministic alphabetical sort, duplicate-id rejection, generic over contract type.
   - `concatenateSpaceApplyInputs` — extensions-first-then-app cross-space ordering.
   - `verifyContractSpaces` — orphan-marker / declared-but-unmigrated / orphan-pinned-dir detection plus per-space hash + invariants comparison.
   - `emitPinnedSpaceArtefacts` — writes `contract.json` / `contract.d.ts` / `refs/head.json` under `migrations/<space-id>/`, byte-deterministic via `canonicalizeJson`.
   - `detectSpaceContractDrift` — three-way classifier (`noDrift` / `firstEmit` / `drift`).
   - `readPinnedContractHash` — read-side primitive for drift detection.
   - `materialiseMigrationPackage` — emit a per-package directory including the contract.json snapshot side-car.
4. **Add the `contractSpace` field to `SqlControlExtensionDescriptor`.** Optional; existing extensions (`pgvector`, `arktype-json`) typecheck unchanged. Schema-contributing extensions opt in by setting it.
5. **Land a synthetic test extension fixture** at `test/integration/test/contract-space-fixture/` — the smallest possible non-package fixture that exercises the per-space machinery end-to-end at the helper layer, without taking on bundle SQL or codec hooks. Hosted under integration-tests rather than as an `@prisma-next/extension-*` package because the fixture has no external consumers and the package shape was incidental.

The 31 commits subdivide into the 10 implementation commits for the moves above (T1.1 → T1.10), 6 doc / fix commits from review rounds (F1 / F2 / F3 in round 1 plus T-cleanup.0/1/2 in M1-cleanup), 4 project-shaping commits (spec / plan / pinned-on-disk decision), and 5 M1-cleanup refactors landed for typology hygiene (F2: marker auto-migration removal; F3: APP_SPACE_ID canonicalisation; F4: framework-components hoist + `materialise…` rename; F6: `Authored*` prefix removal).

## Behaviour changes & evidence

Each change below is plain-English; tests are linked as evidence, not narrated as a separate thread. Sibling reviews are referenced where their conclusions matter for evaluation.

### Behaviour change A — Extensions can publish a contract space; the framework consumes it at authoring time

**What.** A `SqlControlExtensionDescriptor<'postgres'>` (or future `'sqlite'` etc.) gains a new optional `contractSpace` field of type `ContractSpace<Contract<SqlStorage>>` — a `(contractJson, migrations[], headRef)` triple. Schema-contributing extensions set it; codec-only or query-ops-only extensions don't (pgvector / arktype-json typecheck unchanged).

**Why.** Without this field the framework had no way to *see* an extension's structural contributions. The previous workaround (`databaseDependencies.init`) installed SQL via a side-channel and the verifier rejected the resulting objects as "extras." This PR closes the loop at the type level so the planner and verifier can reason about extension schema as first-class.

**Implementation:**
- [packages/1-framework/1-core/framework-components/src/control/control-spaces.ts](packages/1-framework/1-core/framework-components/src/control/control-spaces.ts) — `ContractSpace`, `ContractSpaceHeadRef`, `MigrationPackage`, `APP_SPACE_ID`. Lines 1–82.
- [packages/2-sql/9-family/src/core/migrations/types.ts](packages/2-sql/9-family/src/core/migrations/types.ts) — descriptor field. Lines 130–144.

**Tests (evidence):**
- [packages/2-sql/9-family/test/migrations.types.test-d.ts](packages/2-sql/9-family/test/migrations.types.test-d.ts) — type-level assertions on the descriptor surface. Lines 60–93.
- [test/integration/test/contract-space-fixture/descriptor.test.ts](test/integration/test/contract-space-fixture/descriptor.test.ts) — synthetic descriptor exercises the field end-to-end.

**Architect-pass note (referenced, not duplicated):** `ContractSpace<TContract>` is a flat type that the runtime universally branches on `spaceId === APP_SPACE_ID`. The architect lens raises this as a typology hole the spec deferred to "the control plane" but every consumer in the diff re-encodes. **See [system-design-review.md § A02](system-design-review.md#a02-contractspacetcontract-is-a-flat-type-the-runtime-universally-discriminates-by-id).**

### Behaviour change B — Marker table grows from one row to N rows; pre-1.0 markers are rejected at boot

**What.** `prisma_contract.marker` gains a `space text primary key` column (default `'app'`). Brand-new databases create the per-space shape directly. The runner detects pre-1.0 single-row markers (`id smallint primary key`, no `space` column) and fails the entire `execute()` call with a structured `LEGACY_MARKER_SHAPE` failure.

**Why.** The marker is the source of truth for "what's been applied per space"; it has to grow a per-space dimension for the rest of the mechanism to work. The team chose fail-loud-on-pre-1.0 over silent auto-promotion under M1-cleanup F2 — silent auto-promotion would have masked operator confusion if the on-disk migrations didn't actually match the existing DB state.

**Implementation:**
- [packages/2-sql/5-runtime/src/sql-marker.ts](packages/2-sql/5-runtime/src/sql-marker.ts) — schema + write/read primitives.
- [packages/3-targets/3-targets/postgres/src/core/migrations/runner.ts](packages/3-targets/3-targets/postgres/src/core/migrations/runner.ts) lines 274–319 — Postgres legacy detection.
- [packages/3-targets/3-targets/sqlite/src/core/migrations/runner.ts](packages/3-targets/3-targets/sqlite/src/core/migrations/runner.ts) lines 268–308 — SQLite legacy detection.

**Tests (evidence):**
- [packages/3-targets/6-adapters/postgres/test/migrations/runner.errors.integration.test.ts](packages/3-targets/6-adapters/postgres/test/migrations/runner.errors.integration.test.ts) lines 108–172 — legacy single-row marker triggers `LEGACY_MARKER_SHAPE`; legacy table left untouched.
- [packages/3-targets/6-adapters/postgres/test/migrations/runner.idempotency.integration.test.ts](packages/3-targets/6-adapters/postgres/test/migrations/runner.idempotency.integration.test.ts) — already-migrated marker is a no-op.

**Cross-lens conflict — surface, don't merge.**

The architect lens approves of the `LEGACY_*` prefix (it passes the discriminator-completeness probe — concrete, singular, structural, stable) and approves of the per-target placement of the detection. **See [system-design-review.md § "Discriminator-completeness probe — `LEGACY_MARKER_SHAPE`"](system-design-review.md#discriminator-completeness-probe--legacy_marker_shape).**

The principal-engineer lens raises a buildability concern about the *remediation hint* — *"Drop `prisma_contract.marker` and re-run `dbInit`"* — being destructively under-specified about ledger preservation. **See [code-review.md § F02](code-review.md#f02-legacy_marker_shape-remediation-is-destructively-under-specified).**

These reviews land on different verdicts on the same change because they elevate different evidence: the architect cares whether the *type* and *placement* are right (yes); the principal-engineer cares whether the *operator-facing wording* is honest about its blast radius (not quite). The reviews don't contradict each other — they're orthogonal — but a reader merging them into "OK, this lands cleanly" loses the operability concern. The human reading this walkthrough should weigh both before signing off, not pick one.

Also worth surfacing as a real cross-cutting concern: **AM2's literal text contradicts the shipped behaviour** (the AC says "applies idempotently against a pre-migration single-row marker"; the implementation rejects it). The principal-engineer review marks this as `FAIL (as-written)` with the recommendation to update the AC text rather than the code. **See [code-review.md § F01](code-review.md#f01-sub-spec-am2-contradicts-shipped-marker-promotion-behaviour) and the `Acceptance-criteria verification` table.** This is the single biggest "decide before merge" item: either AC text gets updated as part of merging this PR, or it gets updated in the M2 PR; it cannot stay un-synced into close-out.

### Behaviour change C — Seven framework-neutral helpers land in `migration-tools`; the SQL family wires them in M2

**What.** Adds:

- `planAllSpaces<TContract, TPackage>` — iterates a per-space planner, deterministic alphabetical sort, duplicate-id rejection.
- `concatenateSpaceApplyInputs<TOp>` — orders extension spaces alphabetically before the (single) app-space input.
- `verifyContractSpaces` — pure structural verifier; returns a typed violation list (`declaredButUnmigrated`, `orphanMarker`, `orphanPinnedDir`, `hashMismatch`, `invariantsMismatch`).
- `emitPinnedSpaceArtefacts` — writes `migrations/<space-id>/{contract.json, contract.d.ts, refs/head.json}`, byte-deterministic.
- `detectSpaceContractDrift` — pure 3-way classifier; consumer formats the warning.
- `readPinnedContractHash` — read-side primitive for drift detection.
- `materialiseMigrationPackage` — writes a migration directory including the contract.json snapshot.

All seven are pure (or pure-I/O); all are framework-neutral (`migration-tools` does not depend on `@prisma-next/sql-*`); all are individually well-tested.

**Why.** Per project spec FR3–FR6, contract spaces are framework-level concepts — Mongo and any future family share the same per-space shape. Placing the helpers in `1-framework/3-tooling/migration` keeps them target-agnostic; the SQL family wires them in at its own consumption site in M2.

**Implementation:**
- [packages/1-framework/3-tooling/migration/src/plan-all-spaces.ts](packages/1-framework/3-tooling/migration/src/plan-all-spaces.ts)
- [packages/1-framework/3-tooling/migration/src/concatenate-space-apply-inputs.ts](packages/1-framework/3-tooling/migration/src/concatenate-space-apply-inputs.ts)
- [packages/1-framework/3-tooling/migration/src/verify-contract-spaces.ts](packages/1-framework/3-tooling/migration/src/verify-contract-spaces.ts)
- [packages/1-framework/3-tooling/migration/src/emit-pinned-space-artefacts.ts](packages/1-framework/3-tooling/migration/src/emit-pinned-space-artefacts.ts)
- [packages/1-framework/3-tooling/migration/src/detect-space-contract-drift.ts](packages/1-framework/3-tooling/migration/src/detect-space-contract-drift.ts)
- [packages/1-framework/3-tooling/migration/src/read-pinned-contract-hash.ts](packages/1-framework/3-tooling/migration/src/read-pinned-contract-hash.ts)
- [packages/1-framework/3-tooling/migration/src/io.ts](packages/1-framework/3-tooling/migration/src/io.ts) — `materialiseMigrationPackage`.

**Tests (evidence):**
- [packages/1-framework/3-tooling/migration/test/plan-all-spaces.test.ts](packages/1-framework/3-tooling/migration/test/plan-all-spaces.test.ts) — AM3 determinism explicit.
- [packages/1-framework/3-tooling/migration/test/concatenate-space-apply-inputs.test.ts](packages/1-framework/3-tooling/migration/test/concatenate-space-apply-inputs.test.ts) — extensions-first ordering.
- [packages/1-framework/3-tooling/migration/test/verify-contract-spaces.test.ts](packages/1-framework/3-tooling/migration/test/verify-contract-spaces.test.ts) — three orphan / missing kinds.
- [packages/1-framework/3-tooling/migration/test/emit-pinned-space-artefacts.test.ts](packages/1-framework/3-tooling/migration/test/emit-pinned-space-artefacts.test.ts) — canonical-form, sorted-invariants byte-determinism.
- [packages/1-framework/3-tooling/migration/test/detect-space-contract-drift.test.ts](packages/1-framework/3-tooling/migration/test/detect-space-contract-drift.test.ts) — three-way classifier.
- [packages/1-framework/3-tooling/migration/test/read-pinned-contract-hash.test.ts](packages/1-framework/3-tooling/migration/test/read-pinned-contract-hash.test.ts)
- [packages/1-framework/3-tooling/migration/test/materialise-migration-package.test.ts](packages/1-framework/3-tooling/migration/test/materialise-migration-package.test.ts)
- [packages/1-framework/3-tooling/migration/test/deletable-node-modules.test.ts](packages/1-framework/3-tooling/migration/test/deletable-node-modules.test.ts) — load-bearing AM11 fixture: deletes `node_modules` before invoking the helpers and confirms they succeed using only the user-repo pinned files.

**Architect-pass surface — high-altitude pointer.** The seven helpers are well-shaped at the verb level, but the architect lens flags a typology hole *across* them: the same `{ hash, invariants }` shape is declared under five different consumer-named types (`ContractSpaceHeadRef`, `PinnedSpaceHeadRef`, `SpacePinnedHashRecord`, `SpaceMarkerRecord`, `RefEntry`). **See [system-design-review.md § A01](system-design-review.md#a01-five-of-everything-for--hash-invariants-).** The principal-engineer lens does not re-flag this — at the buildability layer the duplication is harmless — but the human downstream of this walkthrough should weigh whether to consolidate-now or defer; the review surfaces both options without merging them.

### Behaviour change D — Marker schema migration is from `id smallint` to `space text`; existing single-app callers keep working

**What.** Existing call sites that wrote / read the marker via `WriteMarkerInput` continue to compile and run unchanged — `space?: string` defaults to `APP_SPACE_ID` (`'app'`). Per-space callers pass `space` explicitly.

**Why.** Avoids a massive call-site churn while the per-space mechanism rolls out incrementally; the M1 SQL-runtime change is *additive* at the function level even though it's *replacing* at the SQL level.

**Implementation:** [packages/2-sql/5-runtime/src/sql-marker.ts](packages/2-sql/5-runtime/src/sql-marker.ts).

**Tests (evidence):** [packages/2-sql/5-runtime/test/sql-marker.test.ts](packages/2-sql/5-runtime/test/sql-marker.test.ts), [packages/2-sql/5-runtime/test/marker-vs-intercept-ordering.test.ts](packages/2-sql/5-runtime/test/marker-vs-intercept-ordering.test.ts) — both updated to assert against the per-space shape.

### Behaviour change E — Synthetic test extension exercises the per-space machinery without bundle baggage

**What.** A non-package fixture under [test/integration/test/contract-space-fixture/](test/integration/test/contract-space-fixture/) — declares one composite (a `test_box` table for now; substituted from a composite-type because composite-type IR is M3+ work) and one baseline migration. Exposes the same descriptor surface a real extension would.

**Why.** Real consumers (cipherstash, pgvector) carry vendored bundle SQL and runtime entanglements that would dominate any test trying to exercise the per-space mechanism in isolation. The fixture is the smallest representable extension descriptor — sufficient to exercise the planner / runner / verifier helpers end-to-end at the helper layer.

**Implementation + tests:** [test/integration/test/contract-space-fixture/descriptor.test.ts](test/integration/test/contract-space-fixture/descriptor.test.ts) — exercises the descriptor's `contractSpace` shape; [packages/1-framework/3-tooling/migration/test/deletable-node-modules.test.ts](packages/1-framework/3-tooling/migration/test/deletable-node-modules.test.ts) — exercises the no-descriptor property *without importing the fixture* (intentionally, so the test cannot defeat its own claim).

## Compatibility / migration / risk

- **Pre-1.0 marker promotion** is *fail-loud*, not auto-migrate. Operators with a pre-1.0 single-row marker need to drop the table and re-run dbInit. **The principal-engineer review flags F02 — the remediation hint understates the data-state implications;** weigh that before merging if there are pre-1.0 customer DBs in the wild.
- **Existing extension descriptors** (pgvector, arktype-json) typecheck unchanged. The `contractSpace` field is optional on `SqlControlExtensionDescriptor`. M4 (pgvector migration) and M3 (cipherstash) will set the field at their own pace.
- **AC text drift on AM2** (sub-spec) — see code-review.md F01 — is a documentation correction, not a behaviour change. Either land the AC update in this PR's spec edits or in M2's; do not let it carry through to project close-out unsynced.
- **Architect-class typology debt** in five-of-everything for `{ hash, invariants }` and the flat-`ContractSpace`-with-runtime-discriminators pattern are not blockers; they will compound at every M2/M3 consumption site if not consolidated. **The architect's recommendation is to consolidate now;** the principal-engineer's lens does not raise it. The human downstream should weigh urgency given the M2/M3 timeline.
- **Performance (NFR5).** Per-space planner / verifier overhead is O(N spaces) on top of today's single-space pipeline. For real apps (1 + a handful of extensions), the overhead is sub-millisecond — well within the 5% no-extension-baseline budget the spec sets. No regression-risk evidence in the diff.
- **Layering (`pnpm lint:deps`).** `migration-tools` stays contract-type-neutral; `framework-components` carries the cross-target identity types. Layer purity check passes; the architect-pass approves of the bounded-context placement.

## Follow-ups / open questions

For the human reading this walkthrough — concrete decisions to make before merging or to track as M2 carry-forward.

1. **Land the AM2 AC text correction.** Decide whether it lands in this PR's spec edits or in M2; either is fine, neither is blocked. Just don't let it carry into close-out.
2. **Decide architect-class typology consolidation timing.** The architect's [A01](system-design-review.md#a01-five-of-everything-for--hash-invariants-) (consolidate `{ hash, invariants }` to one canonical type) and [A02](system-design-review.md#a02-contractspacetcontract-is-a-flat-type-the-runtime-universally-discriminates-by-id) (flat `ContractSpace` + runtime discriminator) are cheaper to land *before* M2 consumes the surface. The architect recommends consolidating; the principal-engineer doesn't push for it. The human chooses.
3. **Decide whether `LEGACY_MARKER_SHAPE` remediation hint expands** — see code-review.md F02. The blast radius is bounded (pre-1.0 only) so the cost of leaving it as-is is bounded; the cost of expanding the hint is one error-message edit in two runner files plus the integration test's regex.
4. **Decide where space-id validation lives** — see code-review.md F04. Today asymmetric across helpers; the architect's [A07](system-design-review.md#a07-asymmetric-space-id-validation-across-sibling-helpers) raises it as symmetry debt; the principal-engineer raises it as boundary-clarity. Pick one rule, apply uniformly.
5. **Track open questions from the sub-spec at `ee05b2b4f` § Open Questions** — drift-detection severity escalation (`--strict-drift`?), pinned `.d.ts` regeneration target. Both are M2-implementation questions; neither is M1-blocking.

## Non-goals / intentionally out of scope

- **Codec lifecycle hook plumbing (AM8).** Hook contract lands in M1's spec; emitter wiring is M2 (T2.2).
- **`db init` / `db update` per-space CLI consumption (AM9 / AM10).** Helper primitives land in M1; CLI consumer wiring is M2 (T2.3 / T2.4).
- **Single-transaction outer-tx + multi-space rollback (AM4 partial).** Helper-side concatenation lands in M1; runner outer-tx restructure is M2.
- **cipherstash / pgvector migrations (AC10, AC11).** M3 / M4 territory.
- **`databaseDependencies` removal (AC11).** M5 close-out.

## How to read this walkthrough alongside the sibling reviews

- **`system-design-review.md`** is the architect-lens artefact: typology, naming, bounded contexts, dependency direction, conceptual integrity. Read it when evaluating whether the *shape* of the change set will hold up under M2/M3 pressure.
- **`code-review.md`** is the principal-engineer-lens artefact: failure modes, operability, blast radius, AC verification. Read it when evaluating whether the change set is *buildable, correct, and operable* — and look at the AC verification table for the per-criterion verdict.
- **This walkthrough** is the orchestration layer: intent, narrative, behaviour-by-behaviour pointers into the implementation and tests, surfaced cross-lens conflicts. Read it when *touring* the change — and click into the sibling reviews when a specific finding needs depth.

The reviews don't merge into a single verdict on purpose: the human reading this is the decision-maker.
