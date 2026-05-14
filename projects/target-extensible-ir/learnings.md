# target-extensible-ir — orchestrator learnings

> Working ledger maintained by the orchestrator across rounds. Per `.claude/skills/drive-orchestrate-plan/SKILL.md § Project learnings`, lessons here are reviewed at close-out: durable cross-cutting knowledge migrates to repo-level docs; project-local lessons are dropped with the project folder.

## Reasoning-effort checkpoints

The user runs the orchestrator at Opus 4.7 Medium by default for quick execution. The orchestrator escalates to Opus 4.7 High Thinking before performing the tasks below; the user is notified at the start of each checkpoint and can upgrade the configuration. The orchestrator notifies the user to downgrade after the checkpoint completes.

### High-reasoning-effort checkpoints (notify the user before performing)

1. **Intent-validation of any non-trivial reviewer verdict** (per SKILL.md loop algorithm step 7). Specifically:
   - A `SATISFIED` verdict that closes a milestone with substantive scope, or where the verdict-vs-intent gap is non-obvious.
   - A verdict carrying multiple findings whose severities should be re-calibrated against cross-milestone context.
   - Any verdict where the reviewer raised escalations (`E<N>` items) needing user-facing decision surfaces — shaping the decision surface well is the orchestrator's load-bearing contribution.
   - Skip when: the verdict is `SATISFIED` with zero findings on a small scope (medium is fine for the pass-through).

2. **Replan triggers** (per SKILL.md § Replan protocol). When a finding invalidates a milestone's design, when the user adds scope mid-loop, when a deferral expands scope, when intent-validation reveals the spec is wrong rather than the implementation. Translating user decisions into spec/plan edits requires considering downstream cascades across the remaining milestones.

3. **Implementer-vs-reviewer pushback adjudication.** When the implementer brings concrete evidence (file paths, diffs, prior commits) contradicting a reviewer finding. Deciding whether to amend the reviewer's record vs. route to the user requires careful evidence weighing.

4. **Stop-condition triage** (per SKILL.md § Stop conditions). Deciding whether a validation gate failure is an in-scope regression or pre-existing fragility, deciding whether the spec/plan are wrong in a way the orchestrator can or cannot correct from intent alone.

5. **Cross-milestone design review (architectural-drift check).** Once every 2-3 SATISFIED milestones, holistically read the as-built state against the spec to surface architectural drift before it hardens. Recommend at minimum: after M3 SATISFIED (Postgres+SQLite consumers exist; the SPI has been exercised end-to-end for the first time) and after M5b SATISFIED (multi-namespace works end-to-end; the Namespace model has been pressure-tested).

6. **ADR drafting/refining passes.** The 3-layer convention ADR and the architectural-principles ADR have lasting design weight beyond this project (they migrate to `docs/architecture docs/adrs/` at close-out). The substantive draft passes — and the M6 refinement pass — deserve high reasoning. Read-and-spot-check passes are fine at medium.

7. **Final pre-PR synthesis.** Before invoking the team's PR-opening skill, a holistic read of the as-built state against the spec, plus a final intent-validation against all milestones together (not just the most recent one).

### Medium-reasoning-effort work (default — quick execution)

- Scaffolding artifacts (`code-review.md`, sub-agent delegation prompts from templates, heartbeat directory setup).
- Spawning or resuming sub-agents with template-shaped prompts.
- Recording sub-agent IDs in `code-review.md § Subagent IDs`.
- Pre-flight checks before each round (confirming `code-review.md` exists, validating gates are declared, recovering subagent IDs).
- Triage of clean `SATISFIED` verdicts on small-scope milestones with zero findings.
- Pass-through escalations where the reviewer has already shaped the user-facing decision well.
- Routine git operations, explicit-staging discipline, commit-message refinement.
- Reading reviewer/implementer reports for routing decisions.
- Confirming narrative-artifact refresh (verifying `system-design-review.md` and `walkthrough.md` reflect HEAD).

## Pattern: single-target families collapse the abstract-family bar

**Shape.** The 3-layer polymorphic IR convention (framework interface → family abstract base → target concrete class) is the recipe when a family has **two or more** target consumers. When a family has exactly one target today (Mongo: `target-mongo`), per-node IR classes collapse the family-base+target-concrete split into a single concrete-class family form (`class MongoCollection extends SchemaNodeBase` — no abstract; no `MongoTargetCollection extends MongoCollection`).

**Why it matters.** The abstract base earns its existence by having ≥2 consumers that share behavior. For SQL the abstract earns it (Postgres + SQLite share `SqlTable` etc.); for Mongo today the abstract is empty and the target concrete is the only implementation — pure ceremony. The collapse mirrors the Mongo Schema IR precedent (already concrete-class) and prevents within-Mongo asymmetry (Schema IR concrete + Contract IR abstract+target would confuse readers walking the Mongo family).

**Atlas lift recipe.** When a second Mongo target lands (Atlas/DocumentDB/etc.), the collapse-undo is mechanical and consumer-transparent: `class MongoCollection extends SchemaNodeBase { ... }` → `abstract class MongoCollection extends SchemaNodeBase { ... }` + `class MongoTargetCollection extends MongoCollection { /* inherits */ }`. Consumers keep importing `MongoCollection`. No behavior change.

**Action.** During milestone planning for any IR class flip in a single-target family, plan for concrete-class per-node IR matching the family's existing Schema IR shape — not abstract+target. Multi-target families plan for abstract+target per-node IR. The convention is "the abstract base earns its existence by having ≥2 consumers." Spec line 387 (the "AST-class pattern Mongo Schema IR already uses") is the more specific instruction for Mongo; spec line 419's mapping table is a generic illustration of the multi-target shape.

Decision recorded at `wip/unattended-decisions.md § 10`.

## Pattern: filename-filtered gates miss target-flavoured tests under non-target-flavoured paths

**Shape.** A validation gate that filters integration / e2e tests by filename pattern (e.g. `cd test/integration && pnpm test mongo`) silently skips test files that exercise the target's surface but don't carry the target name in their path. Surfaced in M2 R2 → M2 R2-closure transition: two real `pnpm test:integration` failures (`test/cli.emit-command.additional.test.ts` Mongo case; `test/authoring/side-by-side-contracts.test.ts` Mongo side-by-side case) had been red since the M2 R2 class flip landed, but neither path matched the filename filter `mongo`. Verified pre-existing — `git checkout <SATISFIED-SHA> -- <files>` produced an empty diff against the rebase-closure HEAD, confirming the test files were byte-identical at the SATISFIED moment.

**Why it matters.** A filename-filtered gate produces a false-clean signal — the gate runs, returns green, the milestone is declared SATISFIED, and the failures only surface when a downstream round runs the workspace-wide gate. The audit trail then has to reconstruct whether those failures are regressions introduced by the downstream work (innocent-until-proven-guilty) or escapees from an earlier milestone (the actual case here). Either interpretation requires manual investigation; both are noise the round shouldn't be paying for.

**Action.** When a milestone's plan declares a filename-filtered test gate, do one of:

1. **Replace with a name-pattern filter.** `pnpm vitest run --testNamePattern '<TargetName>'` matches by `describe`/`it` text, which target-aware test authors actually populate. Filename filters are a proxy for "tests about the target" that breaks the moment a test file mixes targets or names them in `describe` blocks rather than file paths.

2. **Add a workspace-wide companion gate.** Keep the filename filter for the fast-feedback path, but add `pnpm test:integration` (or the project's workspace-wide equivalent) to the gate as a SATISFIED-blocking check. The wider gate catches the escapees the filter misses; the cost is a slower gate run, which is acceptable at the SATISFIED bar.

3. **At minimum, audit the filter coverage at intent-validation time.** When the orchestrator validates a SATISFIED verdict from a filename-filtered gate, run `rg -l '<TargetName>' test/` (or the equivalent in the project's harness) and cross-check that every match is either inside the filter's catchment or has its own gate path.

The orchestrator's intent-validation pass for SATISFIED on filename-filtered gates explicitly includes this check from M3 onward; updating the plan's gate definitions for M3 and later milestones to use option (1) or (2) by default is a project-internal fix the M3 entry orchestrator note records.

## Pattern: cross-target consistency check is part of intent-validation

**Shape.** When a foundation milestone introduces SPI bases / family abstract bases / shared interfaces, the orchestrator's intent-validation pass MUST include a per-target reachability check: for each (target, family-base) pair the foundation introduces, can the target's package actually `extends <FamilyBase>` without producing a circular workspace dependency?

**Why it matters.** Foundation milestones look correct in isolation (each base is well-shaped; layering in `architecture.config.json` looks fine). The check that fails late is the package-direction one: `family-X` may already depend on `target-X`, in which case `target-X` cannot extend `family-X`'s bases. Surfaced for Mongo in M2 R1 reconnaissance — neither the M1 R1 reviewer nor the M1 R2 orchestrator caught it; the implementer caught it on first read because they were about to author the `extends` clauses. See `wip/unattended-decisions.md § 2`.

**Action.** During intent-validation of any foundation-milestone SATISFIED verdict, run `cat packages/<target-pkg>/package.json | rg '"<family-pkg>"'` for every (target, family-base) pair the milestone introduces. If absent, verify the target CAN add the dependency (no circular path). If a circular path exists, the family base is in the wrong package layer and a placement fix is needed before downstream milestones can consume the foundation.

## M2 R1 reviewer watch-points (from m1 R2 intent-validation)

These are not findings (M1 closed clean) but design choices the M2 reviewer should hold the SPI shape to as the first real consumer exercises it. Surface in the m2 R1 reviewer delegation prompt.

1. **`MongoSchemaVerifierBase.verifyCommonMongoSchema` is abstract in M1; M2 should lower it to concrete with the family-shared walk body.** The comment in M1 says "the M2 commit provides the family-shared implementation". If M2 instead leaves it abstract and provides the body in `MongoTargetSchemaVerifier`, the family base is structurally pointless. The reviewer should verify the lowering happens at the family layer, not at the target layer.
2. **Same pattern for `MongoContractSerializerBase.parseMongoContractStructure`** — M2 provides the family-shared arktype validation; the `constructTargetContract` hook is the only abstract that survives at the family layer.
3. **`MongoTargetStorage extends MongoStorage` should exercise the inheritance.** `MongoStorage` only commits to `namespaces`. If `MongoTargetStorage` adds `collections` and a `MongoTargetStorage`-only constructor without referencing the base meaningfully, the `extends MongoStorage` is nominal-only. Either OK (nominal typing has value) or push for the family to add a structural commitment (e.g. an abstract method that walks all storage objects across namespaces). The reviewer's call.
4. **No call site in M2 should branch on `namespace.id === '__unspecified__'`.** The ADR + namespace.ts comments commit to the singleton-subclass pattern; the reviewer should grep for the literal string in the M2 commits and flag any branch as a `must-fix` finding.

## Notification protocol

- **Before performing a checkpoint:** the orchestrator says "Reaching a high-reasoning-effort checkpoint: `<checkpoint #N>` — `<one-line description>`. Recommend upgrading my configuration before I proceed." and waits for the user's confirmation before continuing.
- **After completing a checkpoint:** the orchestrator says "Checkpoint complete. Recommend downgrading back to Medium for the next stretch." so the user can flip back.
- **If the orchestrator unexpectedly hits a body of work that requires high reasoning** (e.g. a routine triage turns out to be a replan trigger): the orchestrator pauses, surfaces the discovery, and recommends the upgrade before continuing.

## Emit-side canonicalization routes through the per-target ContractSerializer SPI (audit outcome at M3 entry)

**Shape.** `canonicalizeContractToObject` accepts an optional `serializeContract: (contract: Contract) => JsonObject` hook. The framework `emit()` forwards it from `EmitOptions.serializeContract`; the CLI `executeContractEmit` reads it from `descriptor.contractSerializer.serializeContract` (when present) and passes it through. The framework canonicalizer uses the hook to convert the in-memory contract — which may carry class-instance IR nodes whose runtime-only fields must not appear on disk — into a plain JsonObject before applying the family-agnostic key-ordering / default-omission / sort steps.

**Why it matters.** Before this lift, target storage classes hid runtime-only fields from the emitter walk via `Object.defineProperty(..., enumerable: false)`. That pattern multiplies per class-internal field as the IR class hierarchy grows, and inverts the architectural responsibility (target classes guess at what the emitter walks rather than the SPI declaring the on-disk shape). With the lift, the per-target `serializeContract` override owns the "what's on disk" decision; storage classes declare runtime fields freely.

**Concrete consequence.** `MongoTargetStorage.namespaces` is now a normal enumerable class field; `MongoTargetContractSerializer.serializeContract` constructs a stripped JsonObject (`storage: { storageHash, collections }`). Future SQL targets that gain runtime-only IR fields (e.g. `SqlStorage.namespaces` in M5a) follow the same pattern: override `serializeContract` to construct the persisted shape; do not reach for `defineProperty`.

**Action.** When introducing a new IR node class with runtime-only fields, override the family `ContractSerializer.serializeContract` to elide the field from the JsonObject. Do not use non-enumerable property tricks at the class layer.
