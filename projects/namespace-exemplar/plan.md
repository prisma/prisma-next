# Namespace Exemplar — Plan

Companion to [`spec.md`](./spec.md). This plan lays out the branch strategy, the dispatch sequence, the per-dispatch DoR/DoD/scope, the orchestrator playbook, and the carry-over commits from the abandoned PR2 branch.

## Branch strategy

### Source point

Branch: `tml-2520-namespace-exemplar`.
Source: commit `ae7b75917` on `tml-2520-pr2-namespace-exemplar-cross-namespace-fk-references-follow` (`TML-2520: live AC6 PGlite multi-tenancy integration test (M5a R6 AC6)`).

At `ae7b75917`, `SqlStorage` reads:

```ts
class SqlStorage extends SqlNode implements Storage {
  readonly storageHash: StorageHashBase<THash>;
  readonly tables: Readonly<Record<string, StorageTable>>;        // flat — each Table carries its own namespaceId
  readonly namespaces: Readonly<Record<string, Namespace>>;       // populated per FR13 (correct shape)
  readonly types: …
}
```

This is the **last commit before** the FR15-wrong-direction dual-shape commitment (`e6c3a3541 — introduce SqlStorage.tablesByNamespace dual-shape view (M5a R7 substrate)`). All of M5a R1–R6 is preserved: IR sentinel rename, PSL `namespace { … }` parser, target concretions (`PostgresSchema`, `PostgresUnboundSchema`, `SqliteUnboundDatabase`), `StorageTable.namespaceId` coordinate, `SqlStorage.namespaces` map populated via target factory, TS builder `namespaces` declaration, planner schema-qualification plumbing, and the AC6 PGlite multi-tenancy integration test (passing, green).

### Dead branch

`tml-2520-pr2-namespace-exemplar-cross-namespace-fk-references-follow` and PR #529 stay in remote history as a record of what we learned. Once the new PR opens, #529 is closed with a comment pointing at the supersession.

### Carry-over commits (cherry-pick verbatim once Phase 1 is in)

These were pushed on the dead branch in the last hour, are storage-shape-independent, and should land verbatim on the new branch:

- `f68290304 — chore(fixtures): collapse fixtures:check pathspec to ':(glob)**/contract.*'`
- `60b55104a — chore: remove drive-qa-plan/drive-qa-run skills + lockfile entries`
- `674035534 — chore: remove unsolicited CHANGELOG.md`

These three apply cleanly post-Phase 1 (the fixtures:check glob requires the new emit pipeline to be in place first to actually do anything useful). The dispatched cherry-pick is part of Phase 5.

### Untracked-in-worktree files to deal with

The current worktree has untracked `projects/agile-agent-orchestration/{drive-domain-model,references}/` and tool-vendor dirs (`.devin/`, `.windsurf/`). These stay untracked and unaffected by the branch switch; the orchestrator does not interact with them in this project.

## Project-wide ground rules (apply to every dispatch)

These are non-negotiable. Subagent briefs cite them by reference.

1. **No transitional dual-shape phase.** No `tablesByNamespace`, no `nestedTablesView`, no `FlatTablesOf<C>`, no period where flat and nested coexist. Each dispatch leaves the code on the new shape OR untouched; never on a hybrid. If a consumer can't migrate without a bridge, **stop and surface** — that's a design defect to escalate, not paper over.
2. **No `as unknown as` casts** in IR or serializer code. Test fixtures may use narrow scoped casts with explicit `// TODO(narrow): …` comments naming the type-system gap.
3. **No `if (kind === '<literal>')` branches** in framework or family code. Polymorphic dispatch only.
4. **No biome/lint suppressions.** No `@ts-expect-error` outside negative type tests.
5. **No scope expansion** beyond what each dispatch's brief enumerates. If an "obvious" adjacent fix surfaces, the implementer files it as a finding in the structured report and lets the orchestrator decide whether to add a new dispatch — never silently expanding the diff.
6. **No spec drift.** Each dispatch reads the spec FRs before starting and confirms the brief lines up. If the brief contradicts the spec, that's an orchestrator bug — stop and surface.
7. **Commit hygiene.** ≤4 commits per dispatch. Each commit subject names the deliverable in intent terms. DCO sign-off (`git commit -s`) on every commit.
8. **Structured 5-line report back to orchestrator** at end of every dispatch: commits landed, approach chosen, DoD gates passed (each one explicit), surprises encountered (NOT fixed in-dispatch — enumerated for orchestrator triage), residual risk.

## Dispatch sequence overview

| #    | Phase    | Title                                                 | Size | Time-box | Dependencies | Parallelisable |
|------|----------|-------------------------------------------------------|------|----------|--------------|----------------|
| D1.1 | Phase 1  | SQL family `SqlStorage` shape flip                    | M    | 30 min   | none (Phase 0 spec/plan committed) | no |
| D1.2 | Phase 1  | Mongo family `MongoStorage` shape flip                | M    | 30 min   | D1.1 | no |
| D1.3 | Phase 1  | Per-target Namespace concretions gain `tables`/`types` | M    | 30 min   | D1.1, D1.2 | no |
| D2.1 | Phase 2  | SQL + Mongo contract serializers round-trip new shape | M    | 30 min   | D1.3 | no |
| D2.2 | Phase 2  | Emitter generates new shape + regen all fixtures      | M    | 30 min   | D2.1 | no |
| D3.1 | Phase 3  | Framework + SQL family consumer migration             | M    | 30 min   | D2.2 | parallel with D3.2 |
| D3.2 | Phase 3  | SQL targets + adapters consumer migration             | M    | 30 min   | D2.2 | parallel with D3.1 |
| D3.3 | Phase 3  | Mongo + extensions consumer migration                 | M    | 30 min   | D2.2 | parallel with D3.1/D3.2 |
| D4.1 | Phase 4  | `ForeignKey` IR restructure (`{ source, target }`)    | M    | 30 min   | D3.* all complete | no |
| D4.2 | Phase 4  | Cross-namespace FK lowering (PSL + TS + planner + verifier) | M    | 30 min   | D4.1 | no |
| D5.1 | Phase 5  | Example apps + AC5 multi-tenancy live test            | M    | 30 min   | D4.2 | no |
| D5.2 | Phase 5  | Final validation + carry-over cherry-picks + PR open  | M    | 30 min (mostly orchestrator) | D5.1 | no |

**Total: 12 dispatches.** Phases 1, 2, 4, 5 are serial; Phase 3 is 3-way parallel. Optimistic wall-clock with parallel Phase 3: ~5 hours of dispatched work. Pessimistic with no parallelism + 25% rework: ~9 hours.

## Per-dispatch briefs

Each brief below is structured to be pasted directly into a subagent dispatch with light copy-edit (the orchestrator fills in the model slug, the working-directory anchor, and any "recent commits since you last looked" context).

### Phase 0 — Spec + plan in place (orchestrator, no dispatch)

- Cut `tml-2520-namespace-exemplar` from `ae7b75917`.
- Write `projects/namespace-exemplar/spec.md` (this is the source of truth — every dispatch reads it first).
- Write `projects/namespace-exemplar/plan.md` (this document).
- Commit both as the first commits on the new branch with intent-led messages.
- Decision point: do we ship a separate "shaping PR" (spec + plan only) for stakeholder validation before implementation, or proceed directly?

**Exit criteria:** branch created, spec + plan committed, decision recorded.

### Phase 1 — Substrate flip (3 dispatches, serial)

#### D1.1 — SQL family `SqlStorage` shape flip

**Size:** M. **Time-box:** 30 min wall-clock. **Standup cadence:** every 5 min.

**Goal.** Make `SqlStorage` carry only `{ namespaces, storageHash, types? }` — no top-level `tables` field. Tables move *inside* `Namespace`. `StorageTable` drops its `namespaceId` field (the namespace IS the container now; the table doesn't need to stamp its own container's id on itself).

**Files in scope.**
- `packages/2-sql/1-core/contract/src/ir/sql-storage.ts` — drop `tables` field; keep `namespaces`, `storageHash`, `types` (Note: `types` may also move into Namespace per FR2; do the simpler `keep at storage level for now` if `types` is genuinely document-scoped vs per-namespace — clarify by reading the existing usage). Update `SqlStorageInput` to match.
- `packages/2-sql/1-core/contract/src/ir/storage-table.ts` — drop `namespaceId` field; drop the input field.
- `packages/2-sql/1-core/contract/src/ir/sql-unbound-namespace.ts` — `SqlUnboundNamespace` gains `tables: Readonly<Record<string, StorageTable>>` (defaults to empty).
- The Namespace framework interface in `packages/1-framework/1-core/framework-components/src/ir/`. Update to declare `readonly tables: Readonly<Record<string, StorageTable>>` (or whatever the family-shared abstraction is — read first).

**Out of scope.**
- Consumers of `storage.tables` (Phase 3 handles them).
- Serializer round-trip (D2.1 handles).
- Emitter (D2.2 handles).
- Mongo (D1.2 handles).
- Per-target concretions' new fields (D1.3 handles).

**Banned patterns.** No `tablesByNamespace` helper. No `nestedTablesView` getter. No flat `tables` field on `SqlStorage` "for backward compat." If `SqlStorage`'s constructor needs to accept legacy flat input for a single test, **stop and surface** — that's a sign Phase 3 needed to run first.

**Definition of Ready (orchestrator-verified before dispatch).**
- Spec FR1, FR2 read and consistent with this brief.
- New branch at HEAD = spec/plan commits on top of `ae7b75917`.
- `pnpm typecheck` baseline result captured (orchestrator runs `pnpm -r typecheck` and notes the package-level pass/fail to compare against post-dispatch).

**Definition of Done.**
1. `SqlStorage` has no `tables` field; class compiles in isolation (its own `.test-d.ts` if any passes; the rest of the workspace will be red).
2. `StorageTable` has no `namespaceId` field.
3. `SqlUnboundNamespace` carries `tables` (empty default).
4. `pnpm --filter @prisma-next/sql-contract typecheck` may be red (consumers in this package are still on the old shape); explicit enumeration of which files in `sql-contract` itself are red and confirmation they're in Phase 3 scope, NOT this dispatch's scope.
5. ≤4 commits, intent-led, DCO-signed.
6. Structured 5-line report.

#### D1.2 — Mongo family `MongoStorage` shape flip

**Size:** M. **Time-box:** 30 min. **Standup:** every 5 min.

**Goal.** Mirror D1.1 on the Mongo family. `MongoStorage` carries `{ namespaces, storageHash }`. `MongoCollection` (or the equivalent IR class) drops any namespace-stamping field; collections live inside the Namespace.

**Files in scope.** `packages/2-mongo-family/.../mongo-storage.ts` and equivalents. Read first to confirm exact paths and class names.

**Out of scope.** Same as D1.1 — consumers + serializers + per-target concretions handled in later dispatches.

**Banned patterns.** Same as D1.1.

**DoR / DoD.** Same shape as D1.1 with Mongo-package substitutions.

#### D1.3 — Per-target Namespace concretions gain `tables` + `types`

**Size:** M. **Time-box:** 30 min. **Standup:** every 5 min.

**Goal.** `PostgresSchema`, `PostgresUnboundSchema`, `SqliteUnboundDatabase`, `MongoTargetDatabase`, `MongoTargetUnboundDatabase` — each gains `tables` (and `types` where applicable) as instance fields. Construct via input objects; each Namespace concretion's constructor normalises its `tables` input into class instances.

**Files in scope.**
- `packages/3-targets/3-targets/postgres/src/core/ir/postgres-schema.ts` and `postgres-unbound-schema.ts`.
- `packages/3-targets/3-targets/sqlite/src/core/ir/sqlite-unbound-database.ts`.
- Equivalent Mongo target files.
- Any tests on these classes (e.g. round-trip tests) update to the new shape.

**Out of scope.** Consumers (Phase 3), Serializer round-trip (D2.1).

**DoR / DoD.** Same shape as D1.1.

### Phase 2 — Serialization + emit (2 dispatches, serial)

#### D2.1 — Contract serializers round-trip the new shape

**Size:** M. **Time-box:** 30 min.

**Goal.** `SqlContractSerializerBase.deserializeContract` walks `storage.namespaces[id].tables[name]` (not `storage.tables[id][name]`). `serializeContract` produces the canonical JSON envelope matching FR1's at-a-glance sample. Same for `MongoContractSerializerBase`. Round-trip property tests pass.

**Files in scope.**
- `packages/2-sql/9-family/src/core/ir/sql-contract-serializer-base.ts`.
- Mongo equivalent.
- Per-target serializer overrides (`PostgresContractSerializer`, `SqliteContractSerializer`, `MongoTargetContractSerializer`) for any kind-specific deserialization.
- Round-trip tests for both families.

**Out of scope.** Emitter (D2.2), example apps (D5.1).

**Banned patterns.** Same as Phase 1. Specifically: no "if input is flat, upgrade to nested" upcaster shim. Old contract JSON with flat shape **fails to deserialize with a clear diagnostic** — there is no contract.json on disk anywhere in the repo that's still on the old shape post-D2.2.

**DoD additions.**
- Round-trip property tests green (`pnpm --filter @prisma-next/sql-contract test`, equivalent for Mongo).
- `pnpm --filter @prisma-next/sql-contract typecheck` clean (the family base + serializer surface is the most internal layer; if this is red, the substrate is still wrong).

#### D2.2 — Emitter generates new shape + regen all in-repo fixtures

**Size:** M. **Time-box:** 30 min.

**Goal.** `prisma-next contract emit` generates `contract.d.ts` literal types matching the new IR shape exactly: `{ storage: { namespaces: { auth: { tables: { user: { … } } } } } }`. `pnpm fixtures:emit` regenerates every in-repo `contract.{json,d.ts}` against the new shape. `pnpm fixtures:check` exits 0 after.

**Files in scope.**
- `packages/2-sql/3-tooling/emitter/src/index.ts` — `generateTablesType` becomes `generateNamespacesType` (or equivalent rename); generates per-namespace `tables` blocks inside the Namespace literal. Same for `generateTypesType` if types are namespace-scoped per FR2.
- Mongo emitter equivalent.
- Every `contract.{json,d.ts}` file in the repo gets regenerated (run `pnpm fixtures:emit`).
- The fixtures:check glob already covers `':(glob)**/contract.*'` (carry-over commit will land in Phase 5); for now, run `git diff` manually on the contract files post-emit.

**Out of scope.** Consumer code (Phase 3), example apps that fail to emit (D5.1 will repair).

**Banned patterns.** Same as Phase 1.

**DoD.**
1. Emitter generates new shape for a hand-picked test fixture (`packages/2-sql/3-tooling/emitter/test/fixtures/`).
2. `pnpm fixtures:emit` runs successfully.
3. `git status` after emit shows ALL regenerated contracts; `git diff` over a couple of them confirms shape.
4. Commit hygiene: ONE commit per emit-target (one for the emitter source change, one for the regenerated fixtures), so the regen commit is easy to review-by-skip.
5. Structured report enumerates which packages' contracts changed shape.

### Phase 3 — Consumer migration (3 dispatches, parallel)

This is the largest surface — every consumer that walks `storage.tables[name]` migrates to `storage.namespaces[ns].tables[name]` (or `findTableByName(storage, name)` if walking-all-namespaces is the natural intent). Split into 3 parallel dispatches by package layer to keep each dispatch ≤ M.

#### D3.1 — Framework + SQL family consumers

**Size:** M. **Time-box:** 30 min. **Standup:** every 5 min.

**Goal.** Migrate every `storage.tables[name]` access site in:
- `packages/1-framework/**`
- `packages/2-sql/1-core/**`
- `packages/2-sql/2-authoring/**`
- `packages/2-sql/9-family/**`
- `packages/2-sql/3-tooling/**` (except the emitter — already done in D2.2)

**Approach.**
1. Recon via `rg 'storage\.tables\[' <package-list>` + `rg '\.tables\[' <package-list>` (the second catches `someStorage.tables[…]` patterns).
2. Migrate each site:
   - If the call site already knows the namespace coordinate: `storage.namespaces[ns].tables[name]`.
   - If the call site is name-only ("find the table called X without knowing its namespace"): use a `findTableByName(storage, name)` helper that walks `storage.namespaces`. Add the helper if it doesn't exist; it goes in `@prisma-next/sql-contract/utils` (or wherever the existing find-helpers live).
3. Update tests in the same packages.

**Out of scope.** Targets, adapters, Mongo, extensions.

**Banned patterns.** No swallowing of the namespace coordinate (e.g. `[...Object.values(storage.namespaces)].flatMap(ns => Object.values(ns.tables))` when the caller actually has the namespace id — use the direct access).

**DoR.** Phase 2 complete (substrate + serializer + emitter all on new shape; D1.* + D2.* DoD all green).

**DoD.**
1. `pnpm --filter <each-package-in-scope> typecheck` clean.
2. `pnpm --filter <each-package-in-scope> test` clean (or surfaces only baseline-acceptable PGlite flakes — enumerate explicitly).
3. ≤4 commits.
4. Structured 5-line report enumerating which packages were migrated.

#### D3.2 — SQL targets + adapters

**Size:** M. **Time-box:** 30 min. **Standup:** every 5 min.

**Goal.** Same as D3.1 but for:
- `packages/3-targets/3-targets/postgres/**`
- `packages/3-targets/3-targets/sqlite/**`
- `packages/3-targets/6-adapters/postgres/**`
- `packages/3-targets/6-adapters/sqlite/**`

(Plus `packages/2-sql/4-lanes/**` and `packages/2-sql/5-runtime/**` if they have direct storage walks — read first.)

**Approach + Out of scope + DoR + DoD.** Same shape as D3.1 with the target/adapter package list.

#### D3.3 — Mongo + extensions consumer migration

**Size:** M. **Time-box:** 30 min. **Standup:** every 5 min.

**Goal.** Same as D3.1 but for:
- `packages/2-mongo-family/**`
- `packages/3-mongo-target/**`
- `packages/3-extensions/**` (cipherstash, paradedb, pgvector, postgis, sql-orm-client)

**Approach + Out of scope + DoR + DoD.** Same shape as D3.1 with the Mongo + extension package list.

**Phase 3 exit gate (orchestrator-verified, NOT a dispatch).** After all three D3 dispatches complete: `pnpm typecheck` over the full monorepo is clean. Any red files are a Phase 3 implementation bug; cycle back to whichever of D3.1/D3.2/D3.3 owns them.

### Phase 4 — Cross-namespace FK feature (2 dispatches, serial)

#### D4.1 — `ForeignKey` IR restructure

**Size:** M. **Time-box:** 30 min.

**Goal.** `ForeignKey` IR is `{ source: ForeignKeyReference; target: ForeignKeyReference; … }`. Both source and target carry `{ namespaceId, tableName, columns }`. Rename `ForeignKeyReferences` (plural, the wrong name) → `ForeignKeyReference` (singular).

**Files in scope.**
- `packages/2-sql/1-core/contract/src/ir/foreign-key.ts` (and `foreign-key-reference.ts` if separate).
- All consumers that construct or destructure FKs (verifier, planner, serializer, PSL interpreter, TS builder).
- Tests on these classes.

**Out of scope.** Cross-namespace FK lowering at the authoring surface (D4.2).

**DoR.** Phase 3 exit gate green (typecheck clean across monorepo).

**DoD.**
1. `pnpm typecheck` clean across monorepo.
2. `pnpm test:packages` for the affected packages clean.
3. ≤4 commits.

#### D4.2 — Cross-namespace FK lowering end-to-end

**Size:** M. **Time-box:** 30 min.

**Goal.** PSL interpreter lowers `auth.User @relation(fields: [userId], references: [id])` to a cross-namespace FK in the IR. TS builder's `rel.belongsTo` + `constraints.foreignKey` lower automatically when the referenced model lives in a different namespace (via the model handle's namespace coordinate). Planner emits qualified DDL for both sides of the FK. Verifier matches FKs by `(namespaceId, tableName)`.

**Files in scope.**
- PSL: `packages/2-sql/2-authoring/contract-psl/src/interpreter/`.
- TS builder: `packages/2-sql/2-authoring/contract-ts/src/`.
- Planner: `packages/3-targets/3-targets/postgres/src/core/migrations/issue-planner.ts` (and DDL renderer).
- Verifier: `packages/2-sql/.../verify-sql-schema.ts`.
- Tests: `psl-namespace-qualifier-routing.test.ts`, `psl-ts-namespace-parity.test.ts`, and an AC1 PGlite integration test under `test/integration/test/`.

**Out of scope.** Example apps (D5.1).

**DoD.**
1. `pnpm test` for the affected packages clean.
2. AC1 PGlite test (cross-namespace FK end-to-end) passes.
3. AC2 parity test passes.
4. ≤4 commits.

### Phase 5 — Examples + validation + PR open (2 dispatches)

#### D5.1 — Example apps regen + AC5 multi-tenancy live test

**Size:** M. **Time-box:** 30 min.

**Goal.** Every example app emits cleanly under the new shape. `examples/prisma-next-demo` ships the 2-namespace contract (User in `auth`, Post/Task in `public`). `examples/multi-extension-monorepo` regenerates baseline migrations + `refs/head.json` against the new contract hashes (same recipe as the dead branch's hot-fix dispatch). AC5 multi-tenancy PGlite test passes.

**Files in scope.**
- `examples/prisma-next-demo/**`.
- `examples/multi-extension-monorepo/**`.
- Other examples that need regen surface naturally (`pnpm fixtures:check` will fail until they're regenerated).
- AC5 integration test under `test/integration/test/`.

**DoR.** Phase 4 exit gate green.

**DoD.**
1. `pnpm fixtures:check` exits 0.
2. `pnpm --filter <each-example> typecheck && test` clean.
3. `pnpm --filter @prisma-next/example-multi-extension-monorepo run build:contract-spaces` exits 0 (idempotent re-run).
4. AC5 multi-tenancy live PGlite test passes.
5. ≤4 commits.

#### D5.2 — Final validation + carry-overs + PR open (orchestrator-heavy)

**Size:** M. **Time-box:** 30 min (mostly orchestrator + small dispatch slice).

**Goal.** Cherry-pick the three carry-over commits from the dead branch. Run final validation across the monorepo. Open the new PR. Close PR #529 with a supersession comment.

**Steps.**
1. Cherry-pick (orchestrator runs `git cherry-pick`):
   - `f68290304` — fixtures:check glob simplification.
   - `60b55104a` — drive-qa-plan / drive-qa-run removal.
   - `674035534` — CHANGELOG.md removal.
   Resolve conflicts if any (unlikely — these are scope-isolated).
2. Run `pnpm typecheck`, `pnpm test:packages`, `pnpm fixtures:check` on final HEAD. Surface any drift as a finisher dispatch if needed.
3. AC checkbox tick in `projects/namespace-exemplar/spec.md` for AC1–AC6.
4. Run `create-pr` skill (`.claude/skills/create-pr/SKILL.md`): infer title `TML-2520: namespace exemplar + cross-namespace FKs (correct-shape redo)`, draft PR body per the skill's required structure, push branch, `gh pr create`.
5. Close PR #529 with comment: "Superseded by #XXX. The original PR2 shipped a self-contradictory IR shape (FR15 contradicted FR13); rather than unwind ~80 commits of consumer migration onto the wrong shape, we cut a fresh branch from the last commit before the wrong-direction commitment and re-implemented the storage shape correctly. See `projects/namespace-exemplar/spec.md` § 'Why a fresh project'."

**DoD.**
1. New PR open and visible.
2. PR #529 closed.
3. All AC checkboxes ticked.
4. Calibration entry filed in `projects/agile-agent-orchestration/calibration/prisma-next.md` documenting the FR15 mistake (see "Calibration backlog" below).

## Orchestrator playbook

### Per-dispatch protocol

1. **Pre-dispatch (DoR gate, ≤5 min).** Orchestrator:
   - Re-reads the spec FRs the brief touches.
   - Confirms the brief doesn't contradict the spec.
   - Captures a `pnpm typecheck` baseline for the affected packages (so post-dispatch comparison is honest).
   - Confirms previous-dispatch DoD was green.
2. **Dispatch.** Run subagent in background (`run_in_background: true`). Brief includes the size estimate, time-box, scope, banned patterns, DoR, DoD, reporting format.
3. **Standups (every 5 min).** Orchestrator probes:
   - `git log <branch>..HEAD --oneline | head -5` — has the implementer landed commits?
   - `git status -s` — what's in flight?
   - Transcript mtime via `stat -f "%Sm" <transcript-path>` — is the subagent active or hung?
   - First standup at T+5; subsequent at T+10, T+15, T+20, T+25, T+30.
4. **Hang detection.** If transcript mtime is >5 min stale AND no new commits AND no in-flight changes in `git status` for >10 min → subagent is hung. Probe via resume-as-probe (`Task(resume=id, prompt='status check?')` — errors if alive). If dead, dispatch a finisher with the structured residual-work brief.
5. **Scope-drift detection.** If `git status` shows files outside the brief's scope, orchestrator pauses and interrupts (`Task(resume=id, interrupt=true, prompt='Scope drift on <files>. Revert and stick to brief.')`).
6. **Hard stop at time-box.** At T+30, if dispatch hasn't reported done: orchestrator interrupts, asks for residual-work summary, dispatches a finisher with the explicit remaining items.
7. **Post-dispatch DoD verification (≤5 min).** Orchestrator:
   - Verifies each DoD gate explicitly (not "the implementer said it passed" — actually runs the command).
   - Reviews the diff for banned-pattern violations.
   - Confirms commit hygiene (≤4 commits, intent-led messages, DCO-signed).
   - Updates this plan's dispatch table with the actual outcome (size estimate vs actual, time-box vs actual, any DoD gates that failed).

### Failure-mode triggers (intervention thresholds)

These trigger an immediate `Task(resume=…, interrupt=true)`:

- **Dual-shape pattern introduced.** Any commit that adds a `*View`, `tablesByNamespace`, `FlatTablesOf`, or any helper that gives two views of the same data. Stop, revert, restate "no transitional dual-shape" rule.
- **`as unknown as` cast in IR or serializer code.** Stop, revert, fix the types properly or escalate the type-system gap.
- **`if (kind === '<literal>')` branch in framework/family code.** Stop, revert, dispatch through the polymorphic class or registry.
- **Test fixture writes the OLD shape.** Means the implementer is migrating from a stale mental model. Stop, restate the spec FR.
- **Subagent expands scope by >2 files outside the brief.** Stop. Revert the out-of-scope changes (or accept them with a new dispatch entry in this plan).
- **Subagent transcript stale >10 min with no commits.** Hang. Triangulate with resume-as-probe; dispatch finisher if dead.

### Calibration backlog (file at project close-out)

These calibration entries surface from this project; orchestrator files them at D5.2 into the agile-agent-orchestration calibration doc (lives on the dead branch; either cherry-pick the scaffold to this branch before filing, or hold the entries here in the plan and file them as part of merging this PR plus the agile-agent-orchestration handover):

- **§ 3.X — Agent-introduced concrete type expressions must be diff'd against sibling FR text.** Failure mode: FR15 contradicting FR13 silently survived in the spec because the agent transcribing the design decision added a `Record<…>` shape without checking it against the existing `Storage { namespaces: Record<…> }` invariant. Mitigation: when adding a type expression to a spec, the orchestrator (or the agent) must `grep` the spec for `interface <SameType>` and `Record<.*Namespace` (etc.) and verify the new expression doesn't contradict prior text.
- **§ 3.X — Spec internal consistency is a DoR gate, not a review artefact.** No review caught FR15 vs FR13 because review focused on completeness, not consistency. Mitigation: before opening any project for implementation, run a mechanical pass over the spec checking that every "concrete shape claim" (type expressions, JSON samples, at-a-glance code blocks) tells the same story.
- **§ 3.X — Transitional dual-shape helpers compound consumer-migration cost.** Failure mode: the original PR2 introduced `tablesByNamespace` as a "dual-view" thinking it'd ease migration; in fact it created N consumer waves (write to new view; migrate from old view; delete old view) where one wave (`storage.tables → storage.namespaces[ns].tables`) was sufficient. Mitigation: ban transitional dual-shape helpers in any spec touching IR shape; the substrate ships on the new shape, consumers migrate in one pass.

## Risk register

Surface-area risks the orchestrator watches throughout the project:

| Risk | Trigger | Mitigation |
|------|---------|------------|
| Spec edit during execution contradicts a sibling FR | Any in-flight spec edit | Orchestrator runs the consistency-grep before committing the spec edit. |
| Phase 3 consumer migration is bigger than 3×M | D3.* hits >30 min wall-clock | Split into D3.1a, D3.1b, etc. — never let a dispatch overrun the time-box without subdividing. |
| Phase 2 emitter regen breaks a test we don't currently anticipate | D2.2 fails a non-emit test | Confirms a Phase 3 consumer fix is needed earlier; reorder by surfacing the offending consumer to D3.* immediately. |
| Cross-namespace FK PGlite test (AC1) flakes under PGlite worker-pool contention | D4.2 / D5.1 surfaces ECONNRESET | Confirm reproduces on `main` (= baseline flake from the prior calibration entry); document as known issue; don't block landing. |
| Cherry-pick conflicts on the three carry-over commits | D5.2 finds a conflict | Skip the conflicting commit and document why; the carry-overs are scope-isolated, none of them is load-bearing for PR2's correctness. |
| Subagent dies mid-dispatch without completion notification | § 3.15 from prior calibration | Already documented; orchestrator probes via transcript mtime + resume-as-probe, dispatches finisher. |

## Done definition (project level)

This project is shipped when:

1. All 6 ACs in `spec.md` are ticked.
2. PR for `tml-2520-namespace-exemplar` is merged into `main`.
3. PR #529 (the dead branch) is closed.
4. The three calibration entries above are filed.
5. `projects/namespace-exemplar/` is folded into the parent `target-extensible-ir` project status (or deleted at the parent project's close-out per the `drive-project-workflow` rule).

## Decision log

(Empty at plan-write time. The orchestrator appends here whenever a dispatch surfaces a sub-decision that isn't already in the spec — captured in-band, never silently incorporated.)
