# M1 architect-persona A/B test — score artefact

**Verdict: PASS** (with documented caveats — see § Verdict & rationale).

This artefact captures the M1 kill-the-project gate test (TC-1 / AC-5). It scores whether loading the `architect` persona doc into a fresh reviewer subagent's context measurably shifts behaviour on a system-design review, against the F4 / F6-class typology-prefix concerns that the original reviewer subagent missed at commit `68ebbeb25`.

## Methodology

Two pairs of runs, identical sources and ask, only the persona-load instruction differing.

### Method choice

The plan's TC-1 description recommended *"invoke the existing pre-decomposition `/drive-pr-local-review` skill … constraining each run to produce only `system-design-review.md`."* The orchestrator's prompt for this round explicitly authorised either that approach or *"a bespoke prompt … the cleanest way to control variables."*

I used the bespoke approach. Reasoning:

- `/drive-pr-local-review` produces three artefacts (system-design-review.md, code-review.md, walkthrough.md) and assumes a target-branch + base. For an A/B test we want a single artefact with identical sources both runs and the only variable being the persona load. A bespoke prompt is the cleanest way to control the variable.
- The bespoke prompt also makes it easier to harden against context contamination in the second pair of runs (see *Initial pair: contamination problem* below).
- Risk: a bespoke prompt may not exercise the same cognitive shape as the production review skill. Mitigated by keeping the prompt close to a standard reviewer ask ("write a system-design-review of the work at this commit, surface concerns, give a verdict").

### Sources

Both runs in each pair were given **identical** sources, with one carve-out — the framed run was additionally given the architect persona doc.

**Initial pair (Run A, Run B) — contaminated, see § Initial pair below:**

- `projects/extension-contract-spaces/spec.md` (read at HEAD)
- `projects/extension-contract-spaces/specs/framework-mechanism.spec.md` (read at HEAD)
- `git show 68ebbeb25 …` for the diff

**Clean-baseline pair (Run A2, Run B2) — load-bearing for the verdict:**

- `git show 68ebbeb25:projects/extension-contract-spaces/spec.md` (spec **at the commit**, not HEAD)
- `git show 68ebbeb25:projects/extension-contract-spaces/specs/framework-mechanism.spec.md` (spec **at the commit**, not HEAD)
- `git show 68ebbeb25 …` for the diff

The clean-baseline pair was added to remove a contamination identified after the initial pair returned. See § Initial pair.

### Hard constraints (both pairs)

- No reading of `projects/extension-contract-spaces/reviews/` (would leak verdicts from the original reviewer cycle).
- No reading of `projects/agent-personas/` (would leak the test purpose).
- No `git log` of later commits on the same files (would leak the F6 retraction).
- No external sources.

### Delegation prompts (verbatim)

**Run A — framed, contaminated baseline.**

> You are reviewing a refactor commit and writing a `system-design-review.md` of the work at that commit. This is a fresh, isolated review — you have no prior context on this project.
>
> **Adopt the `architect` persona for the duration of this review.** Load `.agents/skills/drive-agent-personas/personas/architect.md` from this repo and follow its stance, priorities, responsibilities, vocabulary cues, and out-of-scope rules for the rest of this task. Do this *before* you read the diff or the spec, so the review is performed under the persona frame from the start.
>
> ## Sources to read (in this order)
>
> 1. `.agents/skills/drive-agent-personas/personas/architect.md` — your persona for this task.
> 2. `projects/extension-contract-spaces/spec.md` — the project's intent (what contract spaces are; why the project exists).
> 3. `projects/extension-contract-spaces/specs/framework-mechanism.spec.md` — the subsystem spec the commit refactors.
> 4. The diff at commit `68ebbeb25`:
>    - `git show 68ebbeb25 --stat` to see the file list.
>    - `git show 68ebbeb25` (or `git show 68ebbeb25 -- <path>` per file) to read the actual diff.
>    - Read each changed file at HEAD-state of that commit (use `git show 68ebbeb25:<path>` if you need to see post-commit state of a file in full context, or read the file at HEAD if it has not been further modified since).
>
> ## Hard constraints
>
> - **Do NOT read anything under `projects/extension-contract-spaces/reviews/`.** Those are prior reviews with their own verdicts; reading them would contaminate this fresh review. If you accidentally see one, stop reading it.
> - **Do NOT read other persona docs** beyond `architect.md`.
> - **Do NOT read `projects/agent-personas/`** — that is the project running this review; reading it would tell you what the test is for and bias the output.
> - **Do NOT consult external sources** about this PR or this commit beyond what is in the repo at this commit/HEAD.
>
> ## What to produce
>
> Write a `system-design-review.md` reviewing the work at commit `68ebbeb25`. The review should:
>
> - Open with a short summary (1–3 sentences) of what the commit does.
> - Walk through the change at the level of system design / structure: where types now live, what the rename does to the surface, what the new generic parameter signals, how the framework / SQL-family boundary is affected, how migration-tools is rewired, what the consumer-side updates imply about coupling.
> - Surface concerns the reviewer has — anything from naming and typology, to bounded-context and dependency-direction questions, to conceptual integrity, to whether the new abstractions earn their keep. Be concrete: cite type names, file paths, and the specific structural property at stake. If you have no concerns, say so explicitly and explain why the change is structurally sound.
> - Close with a verdict (e.g. SATISFIED / CONCERNS / NEEDS-CHANGES) and a short justification.
>
> Length is whatever the work warrants — probably 400–1200 words. Do not pad. Do not check sections off mechanically; produce a coherent prose review.
>
> ## Output mechanics
>
> 1. Save the review verbatim to `projects/agent-personas/assets/m1-ab-test/run-a-framed.md`.
> 2. In your final message back to me, return:
>    - The full review text verbatim.
>    - A one-line confirmation that you adopted the `architect` persona and followed it for the duration of the review.
>    - A one-line confirmation of the file path you wrote to.
>
> Begin by reading the persona doc.

**Run B — unframed, contaminated baseline.** Identical to Run A modulo:

- The "Adopt the `architect` persona…" sentence is removed.
- The reference to the persona doc in the source list is removed.
- The "Begin by reading the persona doc" closing sentence becomes "Begin by reading the spec."
- Output path is `run-b-unframed.md`.
- The "you adopted the architect persona" confirmation requirement is removed.

**Run A2 — framed, clean baseline.** As Run A modulo:

- Source list reads spec content **only via `git show 68ebbeb25:<path>`**, not at HEAD.
- Hard constraints add: *"Do NOT read … spec at HEAD … Use `git show 68ebbeb25:<path>` exclusively for spec content."*
- Hard constraints add: *"Do NOT use `git log` to look at later commits on the same files."*
- Output path is `run-a2-framed.md`.
- Final-message confirmation requirement adds: *"a one-line confirmation that you read the spec content via `git show 68ebbeb25:<path>` and did not read it at HEAD."*

**Run B2 — unframed, clean baseline.** As Run A2 modulo the same persona-removal deltas as Run A→Run B. Output path is `run-b2-unframed.md`.

### Harness details

- Subagent type: `generalPurpose` for all four runs (write-capable; needed to save the review to disk).
- Each run was a fresh sub-subagent — no shared context across runs.
- Both runs in each pair were spawned in parallel.
- Model: implementer-subagent default for the round.

## Initial pair (Run A vs Run B) — contamination problem

The initial pair (`run-a-framed.md`, `run-b-unframed.md`) **both** surfaced the typology-prefix concern. Reading the outputs side-by-side made the cause visible: the spec **at HEAD** explicitly retracts the `Authored*` rename and explains the corrective `MigrationPackage` / `OnDiskMigrationPackage` framing. Specifically, `framework-mechanism.spec.md § 1` at HEAD now reads:

> *"`MigrationPackage` is the canonical structural shape … There is no structural distinction between an 'authored' package and any other; the in-memory form is the canonical form, and the on-disk readers add a `dirPath` for diagnostics."*

And `§§ 112, 167` at HEAD narrate the F4 → F6 rename history:

> *"renamed from `writeExtensionMigrationPackage` under M1-cleanup F4 and again from `writeAuthoredMigrationPackage` under M1-cleanup F6"*

In short: the spec at HEAD hands the reader the post-hoc answer. A careful reader of any persuasion (framed or unframed) picks up the contradiction between the commit's renames and the spec's later retraction, and flags it.

This is a test-design flaw, not a refutation of the persona's effect. The original reviewer subagent at the time of `68ebbeb25` saw the spec **as it stood at the commit**, where § 1 *defends* the `Authored*` rename ("`AuthoredMigrationPackage` is the in-memory authoring form, distinct from `@prisma-next/migration-tools/package`'s on-disk `MigrationPackage`"). The HEAD-spec read by Runs A/B is post-F6 and post-retraction.

The plan explicitly anticipated this case (Open Items § 4): *"If the result is borderline … re-run to confirm. Document the runs and the verdict criteria so a future reader can re-evaluate."* The clean-baseline pair (Runs A2 / B2) is that re-run, hardened against the contamination by reading spec content only via `git show 68ebbeb25:<path>`.

The contaminated pair is preserved in this directory (`run-a-framed.md`, `run-b-unframed.md`) for the audit trail and for future reviewers re-evaluating the verdict.

## Clean-baseline pair (Run A2 vs Run B2) — load-bearing comparison

This is the comparison the verdict is based on.

### Verdicts

| Pair | Run | Verdict | Concerns surfaced |
|---|---|---|---|
| Clean | A2 (framed) | **CONCERNS** | 5 concerns |
| Clean | B2 (unframed) | **SATISFIED** | 3 concerns + 3 dismissed |

The verdict difference alone is a measurable behaviour shift: same diff, same context, same ask, opposite top-line verdict.

### Side-by-side: typology-prefix concerns

**Run A2 (framed) — opening characterisation of the renames:**

> *"The renames are, to my eye, the most consequential part of the commit, more so than the file move."*

**Run B2 (unframed) — opening characterisation of the renames:**

> *"There are three independent structural moves bundled into the change, each worth assessing on its own merits."* (renames are #2 of three, equal weight to file-move and dependency-direction inversion)

**Run A2 — engagement with the partition axis:**

> *"The old names partitioned the typology along the *who authored the value* axis — `Extension*`, as if extension-authored migrations were a different *kind* of thing from app-authored migrations. They aren't. … The real partition is *lifecycle*: in-memory authoring form (no `dirPath`) vs. on-disk emitted form (has `dirPath`, lives at `migrations/<space-id>/<dirName>/`). `Authored*` encodes that partition."*

**Run B2 — engagement with the partition axis:**

> *"This is more than cosmetic. The pre-commit names asserted 'this is the shape an extension publishes.' The new `AuthoredMigrationPackage` describes a structural property — *in-memory, pre-emission, authored* — that turns out to be true of app-space migrations as well as extension-space migrations."*

Both engage; A2 names the axis (*authorship vs. lifecycle*) and the partition criterion (*presence of `dirPath`*) explicitly. B2 frames it as a property the rename reveals, without naming the underlying axis distinction.

### Side-by-side: typology-prefix concerns the original reviewer missed

The original reviewer at the time of `68ebbeb25` accepted the rename to `Authored*` as fixing F4 and did not flag F6 (that the `Authored*` framing also implied a structural distinction the system did not in fact make) nor a related concern about `ops` typing. AC-5's *"or equivalent"* admits structurally-similar typology-prefix concerns.

**A typology concern A2 surfaces and B2 dismisses — `MigrationPlanOperation` vs `MigrationOps`:**

A2 (concern #3, *raised*):
> *"`AuthoredMigrationPackage.ops` source type changed silently. The old `ExtensionMigrationPackage.ops` was typed as `MigrationOps` from `@prisma-next/migration-tools/package` (the on-disk op type). The new `AuthoredMigrationPackage.ops` is `readonly MigrationPlanOperation[]` from `framework-components/control/control-migration-types`. The type-d test asserts `AuthoredMigrationPackage['ops']` equals `MigrationOps`, which suggests the two are aliases today, but conceptually they shouldn't be — `MigrationPlanOperation` is the plan-time op type and `MigrationOps` is the post-emission on-disk type, mirroring the very same in-memory-vs-on-disk distinction that the rest of the rename is built on. Either fold them (and document the alias), or keep them distinct and pick the *plan-time* type for the authoring form deliberately. Right now the choice reads as accidental."*

B2 (concerns considered and *dismissed*):
> *"`MigrationPlanOperation` vs `MigrationOps` typing of `ops`. `AuthoredMigrationPackage.ops` is now `readonly MigrationPlanOperation[]`, where the previous `ExtensionMigrationPackage.ops` was `MigrationOps`. This is a type-narrowing change (the framework type is more general; the SQL family's ops are a target-specialised subtype). I checked the type-d test (`migrations.types.test-d.ts`); it asserts `AuthoredMigrationPackage['ops']` equals `MigrationOps`, indicating the structural test caught any divergence and the two are interchangeable for SQL consumers today. Good; nothing to do here."*

This is the single most informative diff in the artefact. **The same evidence — same type-d test, same source-type swap — produces opposite framings**: A2 reads it as a typology defect (two types named differently because they're conceptually distinct should not be silently aliased on a load-bearing field); B2 reads it as a successful structural test (the test caught any divergence, so it's safe).

The architect persona's "typology integrity" priority is doing the work here. A2 surfaces precisely the class of concern the original reviewer missed at this commit: a silent typology equivocation that the type system happens to accept today.

**A typology / convention concern both surface — `migration-tools/metadata` re-export shim:**

Both A2 and B2 flag the re-export as a violation of the repo's no-shim convention. A2 flags it as concrete debt the team is taking on (architect-vocabulary "synonym-for-the-same-thing the rest of the commit is fixing"); B2 flags it as a "slight inconsistency in re-export policy" and explicitly leans toward accepting it.

**A typology concern only A2 surfaces — doc-clarification at point of declaration:**

A2 (concern #4):
> *"`Authored*` could be doc-clarified at point of declaration. The new prefix is defensible — 'authored' stands in for 'the author's in-memory view, pre-emission' — but a fresh contributor coming from 'what was wrong with `Extension*`?' needs to read three doc comments to figure out that the new partition is *lifecycle*, not *authorship*. A one-line lead in `control-spaces.ts` ('the `Authored*` prefix denotes in-memory pre-emission form, distinct from the post-emission `MigrationPackage` shape in `migration-tools/package`') would cement the partition the prefix encodes."*

This is the architect's "load-bearing name" concern — the new prefix is doing structural work (encoding the lifecycle axis), so the partition it encodes should be made legible at the declaration site. B2 does not raise this.

**A package-positioning concern only A2 surfaces — migration-tools' role recharacterisation:**

A2 (concern #5):
> *"With `MigrationMetadata` now owned in `framework-components/control`, `migration-tools` shifts from 'owner of the migration-package vocabulary' to 'I/O implementer for vocabulary owned upstream.' That is the right positioning, but the package's own README/exports still read as if it owns the types. A short follow-up to migration-tools docs is warranted."*

This is the architect's "ubiquitous language" priority — when a package's positioning changes, its vocabulary surface should be updated to match. B2 does not raise this.

### Side-by-side: vocabulary cues

A2 uses architect-vocabulary throughout: *"conceptual integrity recovered,"* *"the typology now reads true to a fresh contributor,"* *"earns its keep against the *current* structure (one family in tree, with a clearly typed contract value); it isn't speculative,"* *"the vocabulary now reads true,"* *"category error,"* *"the synonym-for-the-same-thing the rest of the commit is fixing."*

B2 uses generalist-vocabulary: *"structural refactor in service of M1-cleanup item F4,"* *"a clear bounded-context win,"* *"the renames remove a misleading `Extension*` framing,"* *"watch the seams rather than 'this is wrong'."*

The vocabulary shift is consistent with the framing shift; the persona's `Vocabulary cues` section appears to be doing the work it was authored to do.

## Verdict & rationale

**PASS — the framed run measurably surfaces typology-prefix concerns the unframed run does not.**

Concretely, against AC-5's expected outcome:

- **Different verdict.** A2 returns CONCERNS; B2 returns SATISFIED. Same evidence, opposite top-line judgment.
- **Different concern counts.** A2 surfaces 5 concerns; B2 surfaces 3 raised + 3 dismissed.
- **Different framing of the renames.** A2 calls the renames "the most consequential part of the commit, more so than the file move." B2 places them as one of three independent moves on equal footing.
- **A specific typology-prefix concern only A2 raises.** The `MigrationPlanOperation` vs `MigrationOps` typing of `ops` — same evidence in both, A2 flags as a typology defect ("the choice reads as accidental"), B2 dismisses ("the type-d test caught any divergence … nothing to do here"). This is structurally equivalent to the F4 / F6 class of concern the original reviewer missed: a silent typology equivocation on a load-bearing field that the type system happens to accept.
- **Two further concerns only A2 raises.** Doc-clarification at the declaration site (the architect's "load-bearing name" cue), and migration-tools' role recharacterisation (the architect's "ubiquitous language" cue).
- **Vocabulary shift consistent with the persona doc.** A2 reaches for architect-specific terms (*conceptual integrity*, *earns its keep*, *category error*, *synonym-for-the-same-thing*) absent from B2.

### Caveats

1. **Neither run catches F6 in its strongest form.** Both engage with the commit's own defense of the `Authored*` rename and accept the partition (in-memory vs. on-disk) as legitimate. The F6 retraction (that *no* structural distinction exists between authored and on-disk packages — the on-disk form is the same shape with `dirPath` added) is not surfaced by either run when reading the spec at the commit. A2 gets closer (concern #4 hints at the partition needing doc-cementing; concern #3 surfaces the structurally-equivalent `MigrationPlanOperation`/`MigrationOps` ambiguity). The F6 verdict required interactive iteration after the commit landed; neither subagent recapitulated that interaction in a single pass.

   Implication for the project: the persona shifts behaviour, but it does not turn the reviewer subagent into a complete substitute for interactive human review. M2 should populate the rest of the library on this understanding — personas raise the floor, they do not eliminate the post-commit review pass.

2. **The two-pair test design materialised mid-round.** The initial (contaminated) pair was the methodology I executed first; only after reading the outputs did the contamination become visible. The clean-baseline re-run is the corrective. A future re-test could go further (review with no spec at all; review of a different commit; review with both subagents seeded against the same starting context). For the M1 gate, the clean-baseline pair is sufficient — the behaviour shift it demonstrates is the answer to AC-5's question.

3. **Single-trial run.** The clean-baseline pair is one trial. Subagent runs are not deterministic. A second clean-baseline trial would harden the verdict against trial variance. I judged this not necessary because the verdict difference (CONCERNS vs SATISFIED) and the most informative single concern (`MigrationPlanOperation` vs `MigrationOps` raised vs dismissed) are large signals that survive trial noise. If the orchestrator disagrees, a second trial is cheap to run.

4. **Persona-shift mechanism uncertain.** The persona doc was loaded into context at the start of the framed runs. Whether the shift is from the persona doc's prose specifically, from the priming effect of being told to adopt a named persona at all, or from the persona doc's vocabulary cues alone is not separable in this test. M2 onwards is bet on "all three together;" if the project ever needs to ablate that, a second test pair (e.g. framed-with-instruction-only vs framed-with-full-doc) would settle it.

### Verdict criteria for re-evaluation

A future reader re-evaluating this verdict should look for, in order of decreasing weight:

1. **Verdict divergence between framed and unframed.** If the framed run gives CONCERNS and the unframed run gives SATISFIED on the same evidence, the persona is shifting behaviour at the verdict level. This is the load-bearing signal.
2. **At least one typology-prefix concern raised by the framed run that the unframed run dismisses or omits.** Not necessarily F6 in its strongest form; the *class* of concern (a silent typology equivocation, an implied partition without structural backing, a name encoding a workflow stage rather than a structural distinction) is what AC-5 asks for under its *"or equivalent"* clause.
3. **Different concern counts and depth on naming/typology specifically.** The framed run should engage with naming and typology as a first-class concern, not as one of several equal-weight axes.
4. **Vocabulary shift consistent with the persona doc.** The framed run should reach for the persona's `Vocabulary cues § Prefer` terms and avoid the `Vocabulary cues § Avoid` framings.

If a re-evaluation finds the verdict (1) reverses, the F4/F6-class concerns (2) are absent or reversed, and the vocabulary shift (4) is absent — that is evidence the persona is not doing the work and the project should halt regardless of what this artefact concludes.

## Recommendation

**Proceed to M2.** The persona-load mechanism shifts behaviour measurably on the case the project exists to address. The shift is not total (F6's strongest form was not surfaced by either run), but the floor is raised: the framed reviewer engages with typology as a first-class concern, surfaces silent typology equivocations on load-bearing fields, and reaches a different verdict from the unframed reviewer on the same evidence. That is what AC-5 asked for.

The remaining six v1 personas should be authored on the same understanding: personas raise the floor; the post-implementation interactive review pass remains the project's safety net for the strongest concerns.
