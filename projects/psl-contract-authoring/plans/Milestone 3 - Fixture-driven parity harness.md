# Fixture-driven parity harness plan

## Summary

Build a **directory-driven TS↔PSL parity harness** that scales coverage by adding fixture folders on disk (no per-case test code). The harness asserts parity at the **normalized Contract IR** boundary (debugging-first), at the emitted canonical `contract.json` boundary (including stable hashes), and adds determinism + diagnostics coverage to keep the PSL authoring surface honest as it expands.

**Spec:** `projects/psl-contract-authoring/specs/Milestone 3 - Fixture-driven parity harness.spec.md`

## Collaborators


| Role         | Person/Team                      | Context                                                           |
| ------------ | -------------------------------- | ----------------------------------------------------------------- |
| Maker        | William Madden                   | Owns harness design + rollout                                     |
| Reviewer     | Framework/tooling reviewer (TBD) | Confirms harness boundaries and stability guarantees              |
| Collaborator | SQL authoring owner (TBD)        | Confirms TS fixture authoring patterns and IR parity expectations |


## Milestones

### Milestone 1: Fixture format + discovery + shared runner

Establish the on-disk fixture contract and a single test runner that discovers cases and executes them uniformly.

**Tasks:**

- Define the fixture directory contract for parity cases:
  - Required files: `schema.prisma` (PSL), `contract.ts` (TS), `packs.ts`, `expected.contract.json`
  - Optional files: `README.md` (case intent), `notes.md` (debug breadcrumbs)
  - Naming and invariants (e.g. packs are config-owned; `expected.contract.json` is provenance-free)
- Choose and document the fixture root:
  - Default: `test/integration/test/fixtures/authoring/parity/<case>/`
  - Add a short “how to add a case” section in the harness test file header (and/or a dedicated README under the fixtures root).
- Implement a discovery helper (single source of truth) that:
  - enumerates `<case>` directories
  - validates required files exist
  - produces a stable case list ordering (deterministic test ordering)
- Implement a shared runner that, per case:
  - creates an integration test directory under the integration fixture app (so `jiti` resolution works)
  - copies fixture inputs into the test directory
  - writes provider-specific `prisma-next.config.*.ts` files (TS and PSL) that both import the shared `packs.ts`

### Milestone 2: Parity assertions (IR + canonical JSON + hashes) + debuggable diffs

Assert parity at the boundaries we care about, with failure output optimized for debugging.

**Tasks:**

- Add the parity suite test file (single test that loops over discovered cases) and assert:
  - **Normalized Contract IR parity** between TS provider and PSL provider (primary diff)
  - **Canonical contract.json parity** between TS and PSL emissions
  - **Stable hashes parity** (at least `storageHash` + `profileHash`; include `executionHash` if emitted for the target)
- Add “diff-first” failure rendering:
  - Prefer IR-level diffs first (structural / stable stringification)
  - Fall back to JSON diffs and then snapshot diffs
  - Ensure diffs are stable across runs (sorted keys, stable ordering)
- Add coverage fixtures for the **already-supported** PSL surface only (no new interpretation in this milestone):
  - models + scalar fields + required/optional
  - `@id`, `@unique`, `@@unique`, `@@index`
  - enums + enum columns
  - defaults: `autoincrement()`, `now()`, literal defaults
  - relations via `@relation(fields, references)` + referential actions
  - named types (`types { ... }`) **without** parameterized attributes
- Ensure the harness asserts canonical invariants (regression guardrails):
  - emitted `contract.json` does not contain top-level `sources`
  - emitted `meta` does not embed schema paths/source IDs

### Milestone 3: Determinism, diagnostics, and gap inventory upkeep

Add explicit determinism tests, codify diagnostics expectations, and keep the TS↔PSL gap inventory current so Milestones 4–5 have a concrete target.

**Tasks:**

- Add determinism coverage:
  - within the same case: run emission twice (TS and PSL) and assert byte-equivalent `contract.json` strings (canonical JSON equality)
  - (optional) assert `contract.d.ts` determinism if practical; otherwise record as manual/spot-check
- Add diagnostics coverage:
  - keep/extend the existing integration test proving unsupported PSL produces span-based diagnostics via the CLI (include at least one fixture-driven invalid case if it improves scalability)
  - ensure diagnostics assert: error code, sourceId (file path), span line/column, and a stable summary
- Update and link the gap inventory:
  - Keep `projects/psl-contract-authoring/references/authoring-surface-gap-inventory.md` current as fixtures surface missing TS behaviors
  - Add a short “Milestone 4/5 targets” section keyed to concrete TS constructs encountered in fixtures (parameterized types, namespaced attrs, default fns, mapping)

## Test Coverage


| Acceptance Criterion                                                     | Test Type   | Task/Milestone          | Notes                                              |
| ------------------------------------------------------------------------ | ----------- | ----------------------- | -------------------------------------------------- |
| Fixture-driven parity harness exists (directory-per-case)                | Integration | Milestone 1 / Tasks 1–4 | Discovery + runner loop over fixture directories   |
| Each case includes PSL + TS + packs + expected snapshot on disk          | Integration | Milestone 1 / Tasks 1–4 | Validate required files; stable ordering           |
| Parity assertions cover normalized IR, canonical JSON, and stable hashes | Integration | Milestone 2 / Task 1    | IR diff first, then JSON/hashes                    |
| Determinism tests exist (emit twice == same artifacts)                   | Integration | Milestone 3 / Task 1    | Canonical JSON string equality                     |
| Diagnostics tests exist (span-based, actionable errors)                  | Integration | Milestone 3 / Task 2    | Assert code + sourceId + span + summary            |
| Gap inventory is linked and kept current                                 | Docs        | Milestone 3 / Task 3    | Record new gaps discovered while building fixtures |


## Open Items

- Confirm the best “normalized Contract IR” API to use for parity comparisons (direct framework normalization helper vs comparing the IR after `emitContract`’s internal normalization step).
- Decide where to store `expected.contract.json` snapshots long-term:
  - alongside cases under `test/integration/test/fixtures/authoring/parity/<case>/expected.contract.json`, or
  - under the integration fixture app’s `fixtures/` subtree for tighter coupling with existing test helpers.
- Decide whether `.d.ts` determinism should be asserted for Milestone 3 or deferred (it’s valuable, but may add noise if formatting is still in flux).

