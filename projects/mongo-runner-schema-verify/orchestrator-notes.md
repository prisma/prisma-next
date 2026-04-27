# Orchestrator notes — `mongo-runner-schema-verify`

> The user is unavailable for the duration of this run and granted the orchestrator autonomy to resolve issues raised by sub-agents on their behalf. This file records every decision the orchestrator made that **would normally have required user input**, with rationale, so the user can audit on return.
>
> Items here are not findings; they are user-attention surrogates the orchestrator absorbed. Each entry is an audit-trail breadcrumb.

## Decisions made on the user's behalf

### 2026-04-26 — Verifier source location divergence (cycle break)

**What surfaced (m1 R1, implementer report):** The spec at § "Where each piece lives" specifies `verifyMongoSchema` source at `packages/2-mongo-family/9-family/src/core/schema-verify/verify-mongo-schema.ts`. Once the runner began importing it, turbo refused to schedule typecheck because of a runtime cycle:
`@prisma-next/target-mongo` → `@prisma-next/family-mongo` → `@prisma-next/adapter-mongo` → `@prisma-next/target-mongo`. The cycle is pre-existing — it became fatal only when the runner introduced the new edge to `@prisma-next/family-mongo/schema-verify`.

**Why this would have been a user-facing decision:** Three resolution paths exist with different architectural costs:

  - **(a) Move `verifyMongoSchema` (and its dependency `schema-diff.ts`) to `@prisma-next/target-mongo`; have `@prisma-next/family-mongo/schema-verify` re-export from there.** Implementer's choice. Smallest scope. Inverts the apparent family→target ordering for this slice (family-mongo's `MongoFamilyInstance.schemaVerify` now calls `target-mongo`'s verifier). `pnpm lint:deps` accepts it. Public surface (`@prisma-next/family-mongo/schema-verify` import path) is unchanged for consumers; spec § "Where each piece lives" file path is the only divergence.
  - **(b) Move marker operations (the other side of the existing cycle) out of `@prisma-next/family-mongo` into a target-tier package, leaving the verifier in family-mongo as spec'd.** Larger refactor; would touch consumers of marker ops; would naturally restore the family-on-bottom layering.
  - **(c) Keep both in place; resolve the cycle by adding a small intermediate package or rewiring a more invasive boundary.** Larger still.

**Decision:** Accept (a). Rationale:
- The spec's intent is "single canonical implementation shared by `db verify --schema-only` and `migration apply`" (R4), not the literal file path. `@prisma-next/family-mongo/schema-verify` still resolves to one canonical implementation; both family-instance and runner compose it.
- (b) would expand scope materially beyond TML-2285 and likely require its own design discussion.
- The follow-up TML-2319 (hoist verify into framework SPI) will naturally relocate the verifier to a framework-tier shared package, resolving the layering question definitively. Until then, target-mongo is a defensible host because it's the package that *consumes* the verifier (the runner) — co-location reduces cross-package surface.
- The cycle was pre-existing (the implementer noted: `family-mongo` already depended on `target-mongo` via marker operations before this round). The relocation removes one side of the cycle rather than introducing a new one.

**Where it lives now:** Captured in the implementer's report § 2 (Decision) and § 7 (Anything surprising). Reviewer will independently evaluate. Spec is **not** amended at this point — orchestrator-notes records the divergence for user review on return; if the user prefers (b) or another path, it is reversible (the verifier source is a standalone module).

**Reversibility:** Trivial. Move two files (`verify-mongo-schema.ts` + co-located tests) and one helper (`schema-diff.ts`) back to family-mongo, and resolve the cycle differently. Public import path stays identical so no consumer-side churn.

### 2026-04-26 — m1 R1 reviewer chat-message vs on-disk verdict mismatch

**What surfaced:** The reviewer's chat-message return claimed `SATISFIED` with one `low / process` finding (F1: branded-cast hygiene). The on-disk `code-review.md` they wrote in the same round records `ANOTHER ROUND NEEDED` with **two `must-fix` findings**: F1 (synthetic-contract test fixtures crash the verifier with `TypeError` instead of opting out — breaks `pnpm test:integration` and `pnpm test:examples`) and F2 (real-contract integration tests fail `SCHEMA_VERIFY_FAILED` because contract IR ≠ canonical Mongo schema for collation, text indexes, timeseries, clusteredIndex, and `changeStreamPreAndPostImages` — a correctness regression that inverts spec R1 for those features).

**Why this would have been a user-facing decision:** The chat-message verdict and the on-disk artifact disagreed. Per the SKILL ("read code on disk, not the implementer's report"), the on-disk artifact is the source of truth. But under different orchestrator process this divergence could have caused silent shipping of a regression.

**Decision:** Trust the on-disk `code-review.md`. Verdict is `ANOTHER ROUND NEEDED`. F1 + F2 dispatched to implementer R2.

**Where it lives now:** Recorded here. Reviewer's chat-message verdict superseded by on-disk verdict. Future rounds should rely on on-disk artifacts only.

**Reversibility:** N/A — this is a procedural observation, not a design decision.

### 2026-04-26 — Validation-gate gap surfaced (plan amendment, not a finding)

**What surfaced:** F1 and F2 were both invisible to the gates the plan documented for T1.14 (`pnpm lint:deps`, `pnpm typecheck`, `pnpm test:packages`). They live in `pnpm test:integration` and `pnpm test:examples`, both of which `AGENTS.md` § Common Commands advertises as part of the project's CI floor. The reviewer ran them and caught the regression; without that, the round would have closed with two real correctness gaps unflagged.

This pattern matches the SKILL's "cross-package validation gate gap" learning: the project's package-scoped gate didn't catch consumer-side failures because the runner's *behavior* changed, even though no public exports were deleted/renamed.

**Why this would have been a user-facing decision:** Expanding validation gates is a plan amendment that affects every future round. Per § Replan protocol it would normally surface to the user.

**Decision:** Amend `plan.md` § Milestone 1 § Build/hygiene to add `pnpm test:integration` and `pnpm test:examples` to T1.14's validation gates. Recorded in `plan.md` directly so future implementer rounds see them. Implementer R2 will run all five gates.

**Where it lives now:** `plan.md § Milestone 1 § Build / hygiene` — T1.14 amended; new T1.17 (F1 fix) and T1.18 (F2 fix) added under a "Round 2: correctness fixes" section.

**Reversibility:** None needed; this expansion is unambiguously consistent with `AGENTS.md` § Common Commands and the project's CI conventions.

### 2026-04-26 — F2 scope decision (correctness fix kept in this PR)

**What surfaced:** F2 expands the round's substantive work materially. The fix is a canonicalization layer between `contractToMongoSchemaIR` and `introspectSchema` covering 5 Mongo feature families (text indexes, collation, timeseries, clusteredIndex, `changeStreamPreAndPostImages`). Without this fix, this PR ships a regression: contracts using any of those features fail `migration apply` post-verify, even on a fresh apply with no out-of-band tampering.

**Why this would have been a user-facing decision:** Per § Replan protocol, "A deferral expands scope beyond what the current PR can defensibly carry" or "A reviewer-promoted 'should fix' item demands new tasks the plan doesn't cover" → user decides scope.

**Options considered:**
  - **(a) Fix in this PR.** Larger diff (canonicalization + regression tests). Honors spec R1 ("a successful `migration apply` against MongoDB guarantees the live schema satisfies the destination contract") for all currently-supported Mongo features. PR ships without regression.
  - **(b) File F2 as a follow-up ticket; ship this PR with the verify step that breaks 5 features.** PR is smaller. But it ships a regression: contracts using `@@textIndex`/collation/timeseries/clusteredIndex/`changeStreamPreAndPostImages` cannot apply at all. R1's guarantee is inverted for those cases. The PR would be net-negative for users of those features.
  - **(c) Ship the verify step gated behind a flag** (`strictVerification: false` by default) until canonicalization lands. Defeats the point of R1 — the new guarantee only holds if you opt in. Adds an opt-in/opt-out toggle on top of the existing `strictVerification` toggle. Complex.

**Decision:** **(a)** — keep F2 in scope of this PR. Rationale:
- (b) ships an outright regression for real Mongo features; not acceptable. The PR's whole purpose (R1) is to *strengthen* the apply guarantee, not weaken it for some feature subsets.
- (c) is a complex partial measure; the right "verify-only-when-safe" gate is the canonicalization itself, not a runtime toggle.
- (a) is bounded: per F2's recommended action, normalize introspected output for the 5 feature families + add regression tests in `schema-verify.test.ts`. The implementer's evidence in the code-review (concrete IR diffs for each feature) makes the canonicalization rules well-defined.

**Where it lives now:** New T1.18 in `plan.md`. F2's open status persists until R2 closes it.

**Reversibility:** If the user prefers (b) on return, the canonicalization commit is isolatable and reverts cleanly. The verify-step commit (`5977e64e9`) and the canonicalization commit can be carried separately on history.

## Replan triggers absorbed

1. **Validation-gate gap, R1 (plan amendment).** Resolved by amending `plan.md § Milestone 1 § Build / hygiene` (T1.14) to include `pnpm test:integration` + `pnpm test:examples`, and adding new T1.17 + T1.18.
2. **F2 scope expansion (plan amendment).** Kept in scope; resolution above. Treated as plan amendment (T1.18), not as out-of-PR follow-up.
3. **Lint gate gap, R3 (plan amendment).** Resolved by amending `plan.md § Milestone 1 § Build / hygiene` (T1.14) to add `pnpm lint`, and adding new T1.19 for the F4 fix.

## Sub-agent disagreements routed

1. **Reviewer chat-message vs on-disk verdict mismatch (m1 R1).** Trusted the on-disk artifact per the SKILL's "read code on disk, not the report" rule. Documented above.
2. **Implementer pushback on F2 text-index canonicalization (m1 R2).** Reviewer's F2 § Recommended action assumed MongoDB preserves `weights` object insertion order, which would let the canonicalizer use insertion order for stable comparison. Implementer's reproduction showed MongoDB returns `weights` alphabetically, breaking that assumption. Implementer extended the rule: alphabetically sort text-direction keys on **both** sides, plus strip live `weights` when the contract authored none (the PSL `@@textIndex` no-weights path). Both extensions are semantically correct — text-key ordering within a text block doesn't affect MongoDB query semantics; relevance is driven by `weights`. Honest pushback accepted; canonicalization is correct as implemented.

### 2026-04-26 — m1 R2 implementer extensions to F2 (semantically equivalent, slightly broader than reviewer's literal recommendation)

**What surfaced:** While closing F2, the implementer found that the reviewer's recommended normalization (driven by introspected `weights` insertion order) didn't actually work because MongoDB returns `weights` alphabetically, not in contract-authoring order. Implementer's two extensions:

1. **Sort text-direction keys alphabetically on both sides.** Compound text indexes preserve their scalar prefix/suffix layout; only the contiguous text block is reordered. Semantic justification: MongoDB does not use text-key ordering within a text block for query semantics — relevance is governed by the `weights` map.
2. **Strip live `weights` when the contract authored none.** Mirrors the existing rule that strips `default_language`/`language_override` when the contract did not specify them; addresses the PSL `@@textIndex([title, body])` (no `weights:`) authoring path.

**Why this would have been a user-facing decision:** Both extensions go slightly beyond what F2 § Recommended action literally said. Strict interpretation of "the implementer must do exactly what the reviewer recommended" would treat them as scope creep.

**Decision:** Accept both extensions. Rationale:
- Without (1), 6 of 10 F2 acceptance tests would still fail — F2 closure is incomplete without it.
- (2) is the same pattern as the existing collation/timeseries/clusteredIndex rules ("strip live fields the contract didn't author") applied to one more field (`weights`); it's not a new architectural decision, just one more application of the same rule.
- Implementer surfaced both as honest pushback with concrete evidence (failure reproductions + semantic argument), per the SKILL's "Honest pushback acceptance" rule.

**Where it lives now:** Implementer's commit `85df12f2a` includes both extensions inline-documented. R2 reviewer will see them in `canonicalize-introspection.ts` and either accept or push back; if the reviewer pushes back, the orchestrator will route the disagreement.

**Reversibility:** Trivial. Both extensions are localized rules in one file; revert is one-line per rule.

### 2026-04-26 — Lint gate gap surfaced (R3, plan amendment)

**What surfaced:** R2's commit `85df12f2a` (F2 fix — canonicalizer) introduced a `sortedText[textIdx++]!` non-null assertion inside `sortTextKeys`. AGENTS.md § Typesafety prohibits suppressing biome lints, and the package-level `lint` task runs `biome check . --error-on-warnings`, so `pnpm --filter @prisma-next/target-mongo lint` (and therefore the repo-level `pnpm lint`) exits non-zero. R3 reviewer reproduced the failure while triaging the implementer's biome-warning observation and filed it as F4 (should-fix).

The gap is the same shape as the R1 lesson (cross-package gates need to be in the plan): the plan's T1.14 gate set didn't include `pnpm lint`, so neither the R2 implementer nor the R2 reviewer ran it. The reviewer caught it in R3 only because the R3 prompt explicitly asked them to triage the biome observation.

**Why this would have been a user-facing decision:** Adding `pnpm lint` to T1.14's permanent validation gate set is a plan amendment that affects every future round (this PR and any sibling PRs reusing the project's plan template). Per § Replan protocol it would normally surface to the user.

**Decision:** Amend `plan.md § Milestone 1 § Build / hygiene` (T1.14) to add `pnpm lint` to the gate suite (now six gates: `lint:deps`, `lint`, `typecheck`, `test:packages`, `test:integration`, `test:examples`). Rationale:
- F4 surfaced precisely because the gate was missing. Adding it prevents recurrence in this round and any future rounds.
- AGENTS.md does not list `pnpm lint` in § Common Commands, but the package-level `lint` task is binding (every package has it; turbo runs it via `pnpm lint`); ignoring it for the validation gate would mean the project's gate set is weaker than CI.
- The reviewer's R3 § Items for the user's attention U3 explicitly recommended this amendment; concrete, defensible, in-scope.

Also added new T1.19 to the plan for the F4 fix (replace the non-null assertion with an explicit early-throw guard inside `sortTextKeys`). The patch is bounded to one helper.

**Where it lives now:** `plan.md § Milestone 1 § Build / hygiene` (T1.14 expanded) and `plan.md § Round 4: lint hygiene` (T1.19 added). Implementer R4 will run all six gates and close F4.

**Reversibility:** None needed; this expansion is unambiguously consistent with AGENTS.md § Typesafety ("Never suppress biome lints") and the package-level lint scripts.

## Replan triggers absorbed

> Items that, if the user were available, would have triggered an § Escalation surface decision per the SKILL's Replan protocol. Recorded here in the canonical shape so the user can re-evaluate.

_(none yet)_

## Sub-agent disagreements routed

> When the implementer pushes back on a reviewer finding (per § Honest implementer pushback), the orchestrator routes the disagreement. Recording each instance here.

_(none yet)_

## Side-quests authorized

_(none authorized)_

## Open items the user should look at on return

_(none yet)_

## CodeRabbit-iteration decisions

> Decisions made during the post-PR `github-review-iteration` run on 2026-04-27 against PR #380. Only items where reasonable people might disagree with the call are recorded here; trivial accept/reject decisions are visible in the PR thread replies.

### 2026-04-27 — A01: descriptor `MongoContract` cast (CodeRabbit option 2 over option 1)

**What surfaced:** CodeRabbit flagged `mongo-target-descriptor.ts:50-58` where `runnerOptions.destinationContract` is cast to `MongoContract`. It offered two options: (1) re-validate at the descriptor via `family.validateContract(...)` for defense-in-depth, or (2) strengthen the comment to reference the upstream validation site.

**Why this would have been a user-facing decision:** The spec § "Decisions made during shaping" #2 explicitly says "Validation is the family instance's job (`MongoFamilyInstance.schemaVerify` validates before delegating). The runner already has a typed `MongoContract` after R6." Picking option 1 would defy that decision; picking option 2 needs the rationale documented because CodeRabbit explicitly recommended it as the second-best option.

**Decision:** Option 2 (strengthen the comment to reference `migration-apply.ts:132`). Rationale: re-validating at the descriptor doubles validation work the CLI already does at the only public entry point and crosses the "validation is the family instance's job" boundary that the spec deliberately drew. The reviewer's actual concern — implicit cross-layer guarantees — is fully addressed by naming the upstream validators in the comment.

**Reversibility:** If a future reviewer prefers option 1, the change is one extra `family.validateContract(...)` call before the cast. Localized to one function.

### 2026-04-27 — A03 / A05: declined the test-file split refactor

**What surfaced:** CodeRabbit flagged two test files for exceeding the 500-line cap from `.cursor/rules/test-file-organization.mdc`: the new `schema-verify.test.ts` (1089 lines) and the pre-existing `migration-m2-vocabulary.test.ts` (758 lines).

**Why this would have been a user-facing decision:** The 500-line cap is a documented project rule. Declining it on a brand-new 1089-line file is a judgement call about where the project actually draws the line in practice.

**Decision:** Decline the split in this PR. Rationale: (a) the rule is `alwaysApply: false` and many existing files exceed it (e.g. `control-adapter.test.ts` at 1653, `interpreter.test.ts` at 1518, `mongo-planner.test.ts` at 1428 — 20+ files between 800-1653 lines); (b) the PR's internal R1-R4 review process did not flag size; (c) the F2 canonicalization sub-suite alone is ~720 lines so even a clean three-way split would still produce a >500-line file without further refactoring; (d) splitting requires extracting shared helpers to a new `test-utils` module, which is a sizeable refactor orthogonal to TML-2285; (e) for `migration-m2-vocabulary.test.ts` the PR's diff was +13 lines (commit `981f82406`) — the size violation pre-existed.

**Where it lives now:** Recorded as `wont_address` decisions in `wip/reviews/prisma_prisma-next_pr-380/review-actions.json` (A03, A05). Reply text on each thread explains the calibration.

**Reversibility:** Trivial. Both tests are still single files; a follow-up PR can split them once a shared `test-utils` helper module is designed.

### 2026-04-27 — A10: F2 false-negative in text-index canonicalization (Spec R1 regression caught post-PR)

**What surfaced:** While the orchestrator was fixing a Coverage CI gap on the previous A02 commit, CodeRabbit posted a fresh `🔴 Critical` finding on `canonicalize-introspection.ts:165-174` (the text-index server-default stripping introduced by R2's F2 fix). The current code strips `weights`/`default_language`/`language_override` from the live index whenever the contract omits them — *unconditionally*, regardless of whether the live value is actually MongoDB's server default. CodeRabbit's reproduction: a tampered live `weights: {title: 5, body: 1}` (non-uniform), `default_language: 'spanish'`, or `language_override: 'idioma'` would canonicalize to the same shape as a default-shaped index, the schema diff would be empty, and `migration apply` would advance the marker/ledger over drift the verifier was supposed to catch.

**Why this would have been a user-facing decision:** This inverts the spec R1 guarantee ("a successful `migration apply` against MongoDB guarantees the live schema satisfies the destination contract") for the three text-index fields, which is exactly what F2 was supposed to fix. The R2 implementer's note (in the earlier R2 sub-agent disagreement entry above) explicitly defended stripping `weights` "as the same pattern as the existing collation/timeseries/clusteredIndex rules" — but the existing rules use `stripUnspecifiedFields`, which only copies through fields the live counterpart *also* has, whereas the text-index strips drop fields outright. The pattern was applied in shape but not in semantics, and the regression slipped past R2/R3/R4 because every existing F2 acceptance test asserted *positive* (non-drift) cases.

**Decision:** Fix in this PR. Rationale:
- Filing as a follow-up would ship a known correctness regression to the only PR that introduces the verify step, defeating the spec R1 guarantee for any user who relies on text-index drift detection.
- The fix is bounded: gate each strip on the live value matching MongoDB's actual default (`hasDefaultTextWeights` helper for `weights`, equality check for `default_language === 'english'` and `language_override === 'language'`).
- Three regression tests in the existing `text indexes` describe block cover the three tampered-live shapes and assert `result.ok === false` with at least one failed schema check, locking the guarantee in.

**Where it lives now:** Commit `e5d74a816`. `review-actions.json` records A10 as `done`. Reply posted to thread `PRRT_kwDOQM0QJc59vnKl` with 👍 + resolve.

**Reversibility:** Trivial. The helper and gates are localized to one function (`canonicalizeLiveIndex`); reverting restores the previous (buggy) behavior. The regression tests would need to invert their assertions if reverted.

**Process note:** This finding plus the Coverage CI gap (commit `30311e568`) on A02 were both caught only because a fresh CodeRabbit pass ran after the PR went green. The internal R1-R4 review gates didn't catch the F2 false-negative because the F2 acceptance suite only exercised happy-path canonicalization. Future test additions for canonicalizers that *strip* fields should include "tampered-live with non-default value" cases by default.

### 2026-04-27 — A06b: declined adding a per-hook timeout helper to the integration test

**What surfaced:** CodeRabbit nitpick on `mongo-runner.schema-verify.integration.test.ts:27-46` recommended wrapping the `beforeAll` replSet startup in `timeouts.databaseOperation` (5000ms).

**Why this would have been a user-facing decision:** The project rule `use-timeouts-helper-in-tests.mdc` says always use the timeouts helper, so on its face the suggestion is project-aligned.

**Decision:** Not actionable. Two reasons: (a) `packages/3-mongo-target/2-mongo-adapter/vitest.config.ts` already sets `hookTimeout: timeouts.spinUpMongoMemoryServer` (60000ms) globally for the package, which the `beforeAll` inherits, so a per-hook timeout would be redundant; (b) the constant CodeRabbit suggested (`timeouts.databaseOperation`, 5000ms) is also wrong for replSet startup — the dedicated constant `timeouts.spinUpMongoMemoryServer` (60000ms) exists exactly for this case and is the one already in effect via the vitest config.

**Reversibility:** N/A — no code change made.

---

## Decision-entry template

```markdown
### YYYY-MM-DD HH:MM — <short title>

**What surfaced:** <which sub-agent, what they said, in one paragraph>.

**Why this would have been a user-facing decision:** <e.g. spec amendment, scope expansion, severity disagreement, plan replan>.

**Options considered:** <(a)/(b)/(c) with consequences>.

**Decision:** <what the orchestrator chose, with rationale>.

**Where it lives now:** <plan amendment / spec amendment / follow-up ticket / accepted deferral>.

**Reversibility:** <if the user disagrees on return, what does the rollback look like>?
```
