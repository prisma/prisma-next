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

**Symptom.** The umbrella failure mode behind the 2026-05-17 reversal. A dispatch is sized L/XL (multiple commits, many files, multiple disciplines), the orchestrator monitors via file-system proxies (commit cadence, file mod rate) rather than reading diffs, validation gates pass throughout, drift compounds across multiple commits, and the violation is invisible until someone reads a specific diff for an unrelated reason.

**Detection signal.**

- Dispatch brief lists "4-6 commits" or "~50-100 files" or "multiple disciplines."
- Orchestrator's monitoring strategy is "check commit cadence" rather than "read diffs."
- Implementer is allowed to run unattended for >> 5 min without commit-level inspection.

**Mitigation.**

- Dispatch DoR refuses to dispatch L/XL.
- All M-or-below dispatches are subject to WIP-inspection cadence (≤ 5 min), including diff reads.
- Brief pre-names the disciplines so the orchestrator can verify each commit lands the correct discipline.

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

### F6. Closed-set typing that satisfies enumeration-only tests while violating open-set spec promise

**Symptom.** The implementation types a value as a closed union of N concrete shapes (e.g. `string | number | Date | bigint | Uint8Array`). The tests exercise exactly those N shapes — strings, numbers, Dates, bigints, Uint8Arrays — and they compile, so the gate goes green. But the spec or NFR demands an *open set* defined by some structural extractor (a codec descriptor's `TInput`, a target's column-type contract, an extension-provided schema). Values outside the closed union but inside the extractor's range fail to compile despite the spec promising they will. The reviewer sees green tests + matching enumeration in the implementation and signs off; the orchestrator's intent-validation step does not probe whether the test set non-trivially exercises the spec's open-set promise.

**Detection signal.**

- The implementation's value-input type is a finite union literal (no `extends infer T`, no extractor at the type level).
- Every test case's value is a member of the implementation's union literal — bytewise.
- The spec or NFR uses words like "codec-defined", "target-defined", "extension-defined", "user-defined", "any shape the X admits", "open-set", "branded types".
- Test names enumerate the spec's example list ("accepts string", "accepts number", "accepts Date") rather than probe the open-set property ("accepts an arbitrary branded type", "accepts an extension-owned class instance").

**Mitigation.**

- When a spec NFR / AC references "codec-defined / target-defined / extension-defined / branded" types, the test set must exercise **at least one type the implementation cannot enumerate** — a branded type, a synthetic codec's `TInput`, an extension-owned class instance, or any other value that fails to compile under the closed union and only compiles when the extractor is real.
- The reviewer's checklist asks: "is at least one test case impossible to satisfy under a hand-coded closed union of the spec's example list?" If no — the test set is enumeration-only and the open-set promise is unverified.
- The orchestrator's intent-validation step probes whether the test set is tautological: name each test case's value, name each implementation-union member, and check whether the two sets are identical. Identical sets are a red flag.

**Reference incident.** 2026-05-21 D10. The SQL DSL `.default(value)` parameter was typed `SqlDslLiteralInput = ColumnDefaultLiteralInputValue | bigint | Uint8Array` (a closed enumeration). The existing AC test (`contract-builder.default.test-d.ts`) exercised exactly those shapes — a string, a number, `null`, an object, a `Date`, a `bigint`, a `Uint8Array` — all members of the closed union. The spec NFR2 said: "JS-native default values pass through without JSON round-trips in the TS DSL. Date, bigint, Buffer, Uint8Array, **and codec-defined branded types** are accepted by `.default(...)` directly, where the codec's `TInput` admits them." The reviewer passed the dispatch (D2 R1); the orchestrator's intent-validation step did not probe the codec-defined arm. Caught by the user reading the implementation. Fixed by replacing the closed union with `CodecInputForDescriptor<FieldDescriptor<State>>`, which reads the codec's `TInput` off the descriptor's `codecFactory` slot, and by adding branded-type / nominal-class test cases that fail to compile under the closed union.

## Slice-shape scope traps

Patterns that have produced scope creep in the past — catch these at triage or slice-spec time, not at execution time.

- _"Add capability X to <one target>"_ that turns out to need contract-level work first. → Triage as project, not slice.
- _"Fix bug in operation Y"_ where Y is parametric over targets. → Watch for "fix on postgres" silently leaking to "fix on all targets" mid-implementation.
- _"Rename concept Z"_ → Almost always project (rename spans every layer + tests + fixtures + docs).

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
