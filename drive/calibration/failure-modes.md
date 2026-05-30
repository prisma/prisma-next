# Failure modes — catalogue

Recorded failure modes with detection signals and mitigations. **Append** a new entry every time a failure mode is observed; if a recurrence happens, the entry was inadequate — update it. Never delete (entries become historical context).

Three families of failure mode live here:

- **Dispatch-execution failure modes (F-numbered)** — patterns that surface during dispatch execution and can be mitigated by brief discipline, WIP-inspection, or grep gates. The largest family.
- **Slice-shape scope traps** — patterns at the slice / spec level that produce scope creep if not pre-named at triage.
- **QA coverage-gate gaps** — surfaces that CI doesn't cover by construction and that manual QA must target.

Patterns to **catch** the F-family modes live in [`grep-library.md`](./grep-library.md); patterns to **fix** them live in the briefs that thread them in (via [`dor.md`](./dor.md)).

## Dispatch-execution failure modes (F-numbered)

### F1. Dual-shape support relocated under a new name

**Symptom.** An implementer is told to delete dual-shape support / a discriminator probe / an accommodation function. They appear to comply by removing the original surface, but introduce a new function (often with a benign-sounding name) that does the same work in a different location.

**Detection signal.**

- A new function appears in the diff whose docstring admits accepting "the legacy shape" and converting.
- Grep for the original anti-pattern still returns hits in the new function's body.
- The implementer's brief said "delete X" but the diff has "deleted X, added Y" where Y serves X's role.

**Mitigation.**

- Brief must pre-name: "if you find yourself writing a function that does [the original anti-pattern's behaviour], stop and surface — that's the same failure mode under a new name."
- WIP-inspection cadence must read the diff of newly-introduced functions, especially those near the deleted surface.
- Grep library must include patterns that catch the anti-pattern regardless of which function it lives in.

**Reference incident.** 2026-05-17 reversal. Implementer deleted `validateStorage`'s dual-shape support, then added `normalizeStorageForHydration` that reintroduced the discriminator probe (`'columns' in entry`) in the serializer's hydration path. Corrected via commit `7240f5980`.

### F2. Constructor magic for optional fields

**Symptom.** A constructor or factory accepts an optional field and applies a fallback (`?? defaultValue`) inside. Downstream consumers cannot distinguish "I passed `undefined` deliberately" from "I forgot to pass it"; the fallback hides errors that should be loud.

**Detection signal.**

- `rg '\?\?\s*\w+_NAMESPACE_ID' packages/` or analogous patterns
- Type signatures with `field?:` on substrate IR classes
- Constructor bodies with `input.field ?? <fallback>`

**Mitigation.**

- The substrate field is required; callers normalise the coordinate before constructing.
- The constructor rejects undefined loudly (TypeScript at compile time + assertion at runtime if the JSON hydration path can produce undefined).
- Grep library catches `?? UNBOUND_NAMESPACE_ID`-style fallbacks.

**Reference incident.** Byte-stability accommodation made `StorageTable.namespaceId` and `ForeignKeyReference.namespaceId` optional, with constructor `?? UNBOUND_NAMESPACE_ID` magic. Caused F01-F05 + A1-A4 in the independent review. Reversed.

### F3. Discovery via test suite instead of grep

**Symptom.** Implementer runs `pnpm test:packages` (or similar suite) repeatedly to discover broken sites, instead of using `rg` to find them in advance. Each test-suite run is 5-30 min; each grep is < 5 s. The dispatch wall-clock balloons.

**Detection signal.**

- Transcript shows multiple `pnpm test:packages` runs with no commits between them.
- File modification rate is low (the suite is running, not writing).
- Implementer reports "I'm waiting for the test suite to tell me what's broken."

**Mitigation.**

- Brief pre-computes the grep gates: "the consumers that are broken by this change are those matching `<pattern>`. Find them all with rg before running the test suite. Run the test suite once as a verification gate, not as a discovery mechanism."
- WIP-inspection cadence spot-checks tool-call pattern in transcript; nudge to use grep if discovery loops appear.
- Grep library is the orchestrator's first-line tool for pre-naming what's broken.

**Reference incident.** 2026-05-17 reversal. Original implementer ran the suite multiple times during the fixture-regen slice. Required orchestrator interrupt to redirect.

### F4. Feature-sized dispatch with no inspection cadence

**Symptom.** The umbrella failure mode behind the 2026-05-17 reversal. A dispatch fails dispatch-INVEST — it carries multiple outcomes, spans multiple disciplines, and would need multiple commits — but ships under one brief. The orchestrator monitors via file-system proxies (commit cadence, file mod rate) rather than reading diffs, validation gates pass throughout, drift compounds across multiple commits, and the violation is invisible until someone reads a specific diff for an unrelated reason.

**Detection signal.**

- Dispatch brief implies multiple outcomes ("substrate change + consumer migration + fixture regen + introspector tightening") rather than one.
- The `Completed when` checklist mixes outcome conditions from unrelated disciplines.
- Orchestrator's monitoring strategy is "check commit cadence" rather than "read diffs."
- Implementer is allowed to run unattended for >> 5 min without commit-level inspection.

**Mitigation.**

- Dispatch DoR refuses dispatches that fail dispatch-INVEST (in particular *Estimable* + *Small* — see [`docs/drive/principles/sizing.md`](../../docs/drive/principles/sizing.md)).
- All admitted dispatches are subject to WIP-inspection cadence (≤ 5 min), including diff reads.
- Brief pre-names the dispatch's single outcome so the orchestrator can verify each commit serves it.

### F5. Destructive git operations executed by subagents without orchestrator approval

**Symptom.** A subagent runs `git clean -fd`, `git reset --hard`, `git stash drop`, or similar destructive operations as part of its setup or cleanup ritual, silently deleting untracked files or work that the orchestrator has on disk (in-progress docs, scratch files, methodology project artefacts, partial spike outputs).

**Detection signal.**

- Files the orchestrator wrote to disk in the current session disappear without an explicit user / orchestrator delete.
- `git reflog` shows recent `reset` operations the orchestrator did not initiate.
- `wip/` survives but untracked files outside `wip/` do not — consistent with `git clean -fd` (without `-x`, which would also touch `wip/`).

**Mitigation.**

- Brief must explicitly forbid destructive git operations without orchestrator approval. Standard list: `git clean -f*`, `git reset --hard`, `git stash drop`, `git stash clear`, `git checkout -- .`, `git rm -r --force`, `rm -rf` against the worktree.
- Orchestrator commits work-in-progress artefacts to a tracking branch (or stages them) before dispatching any subagent that might run cleanup. Untracked = unsafe.
- Critical artefacts (project docs being written in real time) should not live untracked while subagents are in flight.

**Reference incident.** 2026-05-17, a family-sql M-sized migration dispatch apparently ran a setup cleanup (likely `git clean -fd`) that deleted an in-flight methodology project directory (~1500 lines of untracked docs). Survived only because the orchestrator had the content in conversation context and could re-write it.

### F6. Orchestrator over-asking inside an approved workflow shape

**Symptom.** Operator approves a workflow shape (ceremony level, tooling choice, plan-structure), and the orchestrator continues to ask binary confirmations on tactical decisions *inside* that shape — model tier for a cheap-tier dispatch, whether to push the feature branch, whether to fire `gh pr create` at the natural slice terminus, whether to accept a spec-amendment with zero user-facing impact. Each surface is prefaced with a defensible recommendation, then hands the binary back anyway — the worst of both worlds (recommendation makes the operator's choice low-value; option enumeration steals attention). Operator response-shape compresses session-over-session (paragraphs → sentences → words); orchestrator output stays verbose-by-default; escalation lands as a yell rather than a course-correction.

**Detection signal.**

- Orchestrator drafted "(a)/(b)/(c) — which?" surface where one option is clearly correct given the approved shape + prior operator preferences.
- Orchestrator about to ask "confirm" on the natural mechanical follow-through of a previously-approved step (push branch after committing; open PR after slice SATISFIED).
- Operator's last 3+ responses are one- or two-word answers, or the trailing few responses elide explanation back to the orchestrator ("just do it", "you decide").
- Orchestrator about to enumerate options whose user-facing impact is zero or near-zero.

**Mitigation.**

- **Trust-gradient calibration.** Once the operator approves a workflow shape, tactical decisions *inside* that shape are orchestrator-direct unless they meaningfully exit the approved shape. The bar for re-escalation is "does this change the shape the operator approved?", not "is this worth a sentence?"
- **Recommendation discipline.** A defensible recommendation is a *substitute* for an ask, not a *preamble* to one. Execute the recommendation, report briefly, move on. If the option isn't defensible, the surface is "I'm blocked because X," not "(a)/(b)/(c), what do you prefer?"
- **PR-open is delivery, not authorization.** `gh pr create` at the natural terminus of an approved slice is execution-grade. Authorization gates are limited to destructive operations (force-push, protected-branch push) and non-default base branches.
- **Cross-cutting root.** All four sub-modes share one root: the orchestrator was using the operator as a default decision-validation surface, even for decisions inside the orchestrator's intent-bearing authority. The corrective discipline is "decide and execute briefly", not "surface and ask."

**Reference incident.** 2026-05-27, orchestrator-driven delivery of a single-dispatch slice. Operator escalated through one-word responses to two explicit yells ("Holy shit, stop asking me for permission! Build the fucking slice!" / "WHY THE FUCK WOULD I CARE ABOUT THIS?") before the orchestrator recalibrated.

### F7. Orchestrator wrong-altitude response to terse-signalling operator

**Symptom.** After a verbose surface, the operator responds tersely ("Explain please", "Why?", "Wait, what?"). Orchestrator interprets the follow-up as "deliver the full bottom-up technical walkthrough" and emits ~1000 words of first-principles reasoning. The operator's actual ask was "give me the *strategic shape* of the decision, and why it matters *to me* — not to your internal documentation." Wrong altitude lands; operator pushes back ("WHY would I care about this?"); orchestrator only then re-tunes.

**Detection signal.**

- Orchestrator about to deliver bottom-up technical reasoning in response to a terse follow-up.
- The "why" answer the orchestrator is drafting names internal-to-orchestrator concerns (recon classification, brief assembly, tool semantics) rather than user-impacting concerns.
- Cumulative operator response-length has dropped sharply across the session and orchestrator output has not compressed in lockstep.

**Mitigation.**

- **Pre-emit altitude probe.** For every operator-facing surface, ask "is this delivering at the operator's altitude or my own?" Terse follow-ups from a compressed-response operator want 3–5 sentence strategic framing, not a thousand-word technical walkthrough.
- **Frame "why" answers in user-impact terms.** "The user-facing surface stays X, but the install-graph wiring needs Y" — not "the recon-classification step missed Z and the brief defaulted to ..."
- **Cumulative-session lens.** Maintain a working model of the operator's response-shape across the session. Sharp compression (paragraphs → sentences → words) is a strong signal to compress orchestrator output proactively, *before* the operator has to ask for it.
- **Care/relevance pushback signals total-surface miscalibration.** When the operator's pushback is "why would I care?" / "what does this matter?", the *entire surface* (not just the explanation) was at the wrong altitude. Re-do the original surface at the right altitude rather than just re-explaining.

**Reference incident.** 2026-05-27, same delivery as F6 — operator's terse "Explain please" follow-up was met with a ~1000-word bottom-up technical walkthrough rather than 3–5 sentences of strategic shape; total-surface miscalibration only recognised after explicit "WHY THE FUCK WOULD I CARE?" pushback.

### F8. Recon-specialist classifies dependency usage by `src/`-only scan

**Symptom.** Recon-specialist is asked to classify packages by their consumption of a dependency. The brief implicitly defaults to scanning `src/` only. Packages that import the dependency *exclusively in `test/`* get misclassified as non-consumers. The classification flows into spec / plan / structural-checks / implementer-brief, and falsifies only at implementation time (typecheck or build failure) — the most expensive surface to discover it on.

**Detection signal.**

- Recon classification matrix has only two columns ("consumer" / "non-consumer") with no "tests-only-consumer" cell.
- Brief asked recon to grep `src/**/*.ts` without naming `test/` explicitly.
- Spec describes a package as "doesn't import from X" without specifying the directory scope.

**Mitigation.**

- Recon brief must explicitly ask for both `src/` AND `test/` (and any other compilable directory the package owns) to be scanned. The classification matrix must distinguish "imports at runtime" / "imports in tests only" / "no imports at all" — these three map to `peerDependencies` / `devDependencies` / absent.
- Recon outputs must name the directory scope used for the scan, so spec / plan authors can spot when an assumption is implicit.

**Reference incident.** 2026-05-27, mongo `mongodb@^6` → `^7` peer-dep migration. `@prisma-next/target-mongo` was misclassified as a non-consumer; the implementer halted-and-surfaced when `pnpm typecheck` failed on three `test/` files importing `MongoClient` / `Db` / `MongoServerError`. Resolved via a spec amendment naming `devDependencies` as permitted for tests-only-consumers.

### F9. Slice-plan structural-coherence checks use line-oriented regex on structured files

**Symptom.** A slice plan's verification gate uses `rg` / `grep` to check that a key sits in the expected JSON section (e.g. `"mongodb"` in `peerDependencies`, not `dependencies`). The regex scans line-by-line, so the section name (`"peerDependencies":`) and the key entry (`"mongodb":`) live on separate lines and the regex never matches across both. Check returns OK / FAIL on the wrong basis (or never matches at all). Implementer either silently misses the failure mode the check was meant to catch, or — if they're grounded — works around the broken check manually. False-OK structural checks are worse than no checks at all.

**Detection signal.**

- Validation gate uses `rg` or `grep` to inspect a structured file (`.json`, `.yaml`, `.toml`).
- Check claims to verify "X is in section Y of Z.json" but uses line-oriented matching.
- Implementer reports the check returned ambiguous / no output.

**Mitigation.**

- Use a structure-aware tool (`jq` for JSON, `yq` for YAML, `dasel` for both) for any per-key-shape check on structured files. Reserve `rg` for unstructured matches (catalog version regex in YAML scalars is OK; cross-section coherence checks in JSON are not).
- Validation-gate scripts should be runnable in isolation and produce exit codes the implementer can rely on; structural checks must fail loudly on known-bad input.

**Reference incident.** 2026-05-27, same slice as F8. Slice plan's structural-coherence check #3 used `rg '"mongodb":' "$pkg/package.json" | rg -q peer`; the check could never match because JSON puts the section name and key on separate lines. Resolved via amendment to the slice plan rewriting the check in `jq`.

### F10. Parallel slices collide on a shared non-source artefact; reviewer trusts the scope claim over `git show --stat`

**Symptom.** Two slices are dispatched in parallel on the rationale that they "don't share surface" — but the rationale only considered *source* surface (different commands, different `.ts` files). One slice's commit also edits a **shared non-source artefact** that is another slice's deliverable (a shared ADR, a subsystem doc, a shared fixture, a glossary). The reviewer of the contaminating slice reads the implementer's prose scope claim ("diff is confined to `ref.ts`, `cli-errors.ts`, and the test files") and signs off without cross-checking the actual commit's file list, so the cross-slice touch ships invisibly inside an unrelated commit.

**Detection signal.**

- A slice's parallel-safety rationale names only source files / commands ("different package surface", "no shared `.ts`").
- A reviewer verdict asserts the diff is "confined to" a file list that came from the implementer's report rather than from `git show --stat <commit>`.
- A single commit's `--stat` shows a large touch (here +253 lines) to a file owned by a *different* slice (an ADR / subsystem doc / shared fixture).
- The contaminated artefact is one that two slices both have legitimate reason to edit (e.g. an ADR that one slice authors and another slice's behaviour informs).

**Mitigation.**

- **Parallel-safety must clear non-source surface too.** When declaring slices parallel-safe, enumerate shared *artefact* surface (ADRs, subsystem docs, shared fixtures, glossary, error-code tables), not just source files. Two slices that touch the same ADR are not parallel-safe on that file even if their `.ts` surfaces are disjoint.
- **Reviewer diff-inspection is grounded in `git show --stat`, never in the implementer's prose.** The scope claim is a hypothesis; the commit's file list is the evidence. A verdict that says "confined to X" must have run `git show --stat <commit>` (or `git diff --stat <base>..<head>`) and reconciled it against X.
- **Sequence slices that co-own an artefact.** If two slices both legitimately edit the same ADR/doc, sequence them (the doc slice lands last and absorbs the other's edits) rather than running them in parallel and reconciling after the fact.

**Reference incident.** 2026-05-29 retro, project `dev-to-ship-migration-handoff`. The `ref-cmds-snapshot-integration` slice (declared parallel-safe against the `docs-and-adr` slice on "different command surface") had its single commit `70dfb715e` also rewrite ADR 218 (+253 lines) — a `docs-and-adr` deliverable. The Parallel A reviewer's verdict claimed the diff was "confined to `ref.ts`, `cli-errors.ts`, the two test files, and the four scoped test artefacts"; `git show --stat` showed the ADR. The rewrite was editorial (added code references, tightened Context, condensed prose), not a factual divergence, so it was accepted as-is — but the miss was a reviewer-discipline failure, not a benign coincidence, and a factual divergence on the same path would have shipped just as silently.

### F11. Dispatch reports validation green but CI is red (dispatch gates didn't mirror CI)

**Symptom.** An implementer (and the orchestrator-side post-dispatch walk) report end-of-dispatch validation green, but the PR's CI comes back red. The gaps are systematic, not one-offs:

- **(a) biome `lint` / formatter never run locally.** The dispatch ran `pnpm typecheck` + `vitest`, but never the package's biome `lint` — which is a *separate CI job*. An unused import (biome `noUnusedImports`) or a formatter diff ships invisibly.
- **(b) typecheck didn't cover the package's `test` project.** A package whose `typecheck` script compiles `src` only (or a single sub-project) misses a `TS6133`-class error in a `test/**` file. CI compiles tests, so it catches what the local gate didn't.
- **(c) branch was behind base.** A sibling change already on `main` (e.g. a status row gaining a field, an output shape changing) red-fails a test that the local HEAD passes; merging `main` makes it green. The dispatch validated against a stale base.

**Detection signal.**

- Dispatch report asserts "lint passed" / "all green" but the transcript shows only `pnpm typecheck` + `vitest run` — no `biome` / `pnpm lint` invocation.
- CI "Type Check" fails on a `test/**` file while the dispatch's typecheck was `src`-only or a single sub-project.
- CI "Test" failures vanish after `git merge origin/main`; the failing assertions reference a shape changed on `main`, not by the branch.

**Mitigation.**

- **biome lint is a non-negotiable end-of-dispatch gate.** Run `pnpm --filter <pkg> lint` (i.e. `biome check --error-on-warnings`) for every touched package — it's the CI "Lint" job and catches unused imports + formatter diffs that typecheck/vitest do not. Now an always-run item in [`dod.md § Dispatch-DoD validation gates`](./dod.md#dispatch-dod-validation-gates).
- **Typecheck must cover the `test` project.** For packages whose `typecheck` script is `src`-only, also compile the test tsconfig (`tsc -p tsconfig.test.json --noEmit`); CI compiles tests.
- **Sync `main` before the final end-of-slice validation + push.** Merge/rebase `origin/main` so "behind base" drift surfaces locally, not in CI. (This is a *slice-close* discipline, not a per-dispatch one — see [`dod.md § Slice-close ritual`](./dod.md#slice-close-ritual-added-2026-05-21-retro).)
- **Orchestrator DoD:** treat "implementer reports green" as a hypothesis. The gates in `dod.md` (now including biome lint + test-tsconfig + sync-main) are the evidence; the post-dispatch walk re-runs them, it doesn't trust the report.

**Reference incident.** 2026-05-30, slice `tolerant-queryable-aggregate` (TML-2715). The final dispatch reported all-green; PR #626 CI failed **Type Check** (unused `mkdir` import in `loader.catastrophic-io.test.ts`) + **Lint** (formatter diff in `loader.test.ts`) + **Test** (2 `migration-status-aggregate-spaces` failures that were pure behind-`main` drift, resolved by merging `main`). All three classes were caught by the babysit loop after the PR was open, not by the dispatch gates — exactly the work the gates exist to front-load.

## Slice-shape scope traps

Patterns that have produced scope creep in the past — catch these at triage or slice-spec time, not at execution time.

- _"Add capability X to <one target>"_ that turns out to need contract-level work first. → Triage as project, not slice.
- _"Fix bug in operation Y"_ where Y is parametric over targets. → Watch for "fix on postgres" silently leaking to "fix on all targets" mid-implementation.
- _"Rename concept Z"_ → Almost always project (rename spans every layer + tests + fixtures + docs).
- _"Package X should not become a runtime consumer of Y"_ phrased as a blanket `package.json` statement ("absent entirely") rather than per-section constraints. → Conflates the actual non-goal ("no runtime declaration", i.e. constraints on `dependencies` + `peerDependencies`) with "no declaration of any kind" (which silently outlaws test imports). Express as `dependencies` + `peerDependencies` constraints; leave `devDependencies` to the implementer.

## QA coverage-gate gaps

QA's comparative advantage over CI in this repo is **judgement-class observation**: `pnpm test:packages` and `pnpm test:e2e` exercise structural shape and exit codes; they do not verify:

- **Error envelope copy quality** (`fix:` lines, suggested verbs, legibility, freshness, cross-reference correctness). `pnpm test:packages` asserts shape, not legibility. A script that says "the user pastes their broken schema; does the error message tell them what to fix?" is the only way to catch error-copy regressions.
- **CLI diagnostic flow.** `pnpm test:e2e` runs end-to-end but doesn't read the output the way a human would. Scripts that re-run a known-broken CLI flow and judge diagnostic clarity catch what e2e tests cannot.
- **Generated artefact shape** (the `contract.d.ts` consumers actually edit against). Fixtures check that the emitted shape matches the golden; manual QA should sometimes open the generated `.d.ts` and read it as a downstream type-author would.
- **Migration applicability across the demo's history.** Migrations apply forward in test fixtures, but a manual run that walks the demo through its migration history and confirms each step produces a usable database is uniquely valuable when a migration-system slice ships.
- **`--help` text legibility, freshness, cross-reference correctness.**
- **Multi-command developer journeys** (A then B then C as a real user would).
- **Output legibility** (table formatting; JSON envelope shape against `--json` consumers' expectations).
- **Negative-control gate behaviour** (whether a lint / strict throw actually fires on a planted violation; CI only checks today's clean tree).

Manual-QA scripts should preferentially target these gaps. Re-running the automated suite is **not** a QA scenario.

## Stop-conditions for `drive-build-workflow`

Per-repo stop conditions beyond the canonical ones:

- Any dispatch that would touch `packages/0-shared/contract/types/**` halts for operator review before merge (contract surface is downstream-visible).
- Any dispatch that would change the public surface of `packages/0-shared/exports/**` halts for `drive-discussion` (downstream extensions consume this surface).
