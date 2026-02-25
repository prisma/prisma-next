# Prune docs (public-safe docs set)

## Summary

Prune and reshape the repository documentation so it’s safe to publish publicly: remove internal strategy/planning docs, remove exploratory threads that aren’t meant to be stable public references, remove competitor/market framing, and ensure the remaining docs are coherent and navigable. Track the most problematic removals in a local-only log so we can assess after the fact whether a history rewrite is worth considering.

**Spec:** `projects/prune-docs/spec.md`

## Collaborators


| Role         | Person/Team                    | Context                                                                                    |
| ------------ | ------------------------------ | ------------------------------------------------------------------------------------------ |
| Maker        | Repo maintainer (TBD)          | Drives execution and ensures acceptance criteria are met                                   |
| Reviewer     | Senior maintainer (TBD)        | Reviews deletions/rewrites for public-safety and technical correctness                     |
| Collaborator | Security-minded reviewer (TBD) | Sanity-check that removed/rewritten docs don’t leak sensitive operational/security details |


## Milestones

### Milestone 1: Inventory + guardrails for execution

Produce an explicit inventory of what will be kept/rewritten/removed, and set up the workflow guardrails (local-only log, checklists) so pruning work is reviewable and auditable.

**Tasks:**

- Verify `/wip` is in the root `.gitignore` (the local-only removal log must never be committed).
- Create and maintain the local-only log `wip/prune-docs/problematic-removals.md` (do not commit).
- Inventory documentation sources in-scope for pruning:
  - `docs/**`
  - root docs: `README.md`, `AGENTS.md`
  - package `README.md` files only insofar as they link to pruned docs or include out-of-scope internal framing
- Add a “Doc inventory” table to this plan (or an adjacent committed doc under `projects/prune-docs/plans/`) with:
  - Path
  - Classification (keep / rewrite / remove)
  - Notes (why)
  - Link updates needed (what links to it)
- Define the working “sensitive content checklist” (from the spec) as a short, copy/pasteable checklist in the plan so reviewers can apply it consistently during review.

**Sensitive content checklist (apply to kept/rewritten docs):**

- No internal stakeholder names / team names / codenames (unless explicitly intended for public release)
- No private preview / NDA program details or partner identities (unless explicitly intended for public release)
- No internal-only links (trackers, internal docs systems, private dashboards, invite links)
- No internal domains / emails / non-public endpoints
- No operational/security details that materially increase risk beyond what a public OSS audience needs

### Milestone 2: Remove internal/exploratory docs and competitor framing

Apply the inventory: delete or rewrite the targeted internal/exploratory docs and remove competitor/market analysis framing from remaining docs/ADRs/style guides without introducing new gaps.

**Tasks:**

- Remove internal strategy/planning artifacts called out by the spec (and any other items discovered during inventory that meet the same criteria).
- Remove exploratory architecture threads called out by the spec (and any other exploratory docs discovered during inventory).
- Remove competitor ORM name references and “comparison harness” framing from docs (keep the technical substance where useful; drop comparative framing).
- Review ADRs and style guides for competitor/market framing; rewrite to neutral, technical language.
- As each removal/rewrite is performed, add an entry to `wip/prune-docs/problematic-removals.md` with category + severity + recommendation (no verbatim sensitive content).
- Run a repo-wide check for internal-only links (issue trackers, private docs systems, invite links) and remove/redact them.

### Milestone 3: Rewire navigation + final verification + close-out

Ensure there are stable entry points into the remaining docs, all links are valid, and acceptance criteria are verified with a repeatable checklist.

**Tasks:**

- Update `AGENTS.md` so “Start Here” links only point to the retained public-safe docs set.
- Add a canonical docs index (e.g. `docs/README.md`) and link it from the appropriate entry points (`README.md` and/or `AGENTS.md`).
- Fix broken internal links caused by doc removals/renames across:
  - `docs/**`
  - root docs
  - relevant package `README.md` files
- Final verification pass:
  - Repo-wide search confirms competitor ORM name references are fully removed.
  - Sensitive content checklist applied to all rewritten/kept docs.
  - `wip/prune-docs/problematic-removals.md` reviewed to assess whether “consider history rewrite” is warranted (decision deferred; the output is the evidence).
- Close-out (required by repo project workflow):
  - Verify acceptance criteria are met (link to the verification evidence / checklist).
  - Migrate any long-lived conclusions into `docs/` if they were captured under `projects/prune-docs/`.
  - Delete `projects/prune-docs/` (transient) in the final PR for this project.

## Test Coverage

This project is doc-focused; verification is primarily **manual** plus repeatable **repo-wide searches**. Every acceptance criterion from the spec must be mapped to at least one verification task.


| Acceptance Criterion (Spec)                                             | Test Type                  | Task/Milestone                        | Notes                                                               |
| ----------------------------------------------------------------------- | -------------------------- | ------------------------------------- | ------------------------------------------------------------------- |
| Internal strategy/plan docs are removed/rewritten as required           | Manual                     | Milestone 2 tasks                     | Validate by inspecting the resulting doc set and diff               |
| Exploratory thread doc is removed (and similar exploratory docs pruned) | Manual                     | Milestone 2 tasks                     | Ensure no remaining references link to removed docs                 |
| No competitor ORM references remain repo-wide                           | Manual (repeatable search) | Milestone 3 “Final verification pass” | Keep the plan/spec neutral; use local search terms during execution |
| `AGENTS.md` doesn’t link to removed/internal docs                       | Manual                     | Milestone 3 “Update AGENTS.md”        | Also verify links render correctly in GitHub                        |
| Canonical docs index exists and is linked                               | Manual                     | Milestone 3 “Add docs index”          | Ensure index doesn’t reintroduce internal framing                   |
| Local-only problematic removals log exists and is maintained            | Manual                     | Milestone 1 + Milestone 2 tasks       | Must remain untracked; no verbatim sensitive content                |
| Sensitive content checklist is applied and violations addressed/logged  | Manual                     | Milestone 3 “Final verification pass” | Use the log as supporting evidence                                  |


## Open Items

- **Collaborators (names/teams):** Replace “TBD” roles with actual maintainers/reviewers once assigned.
- **Banned term list location:** Avoid committing sensitive internal terms. During execution, keep the actual search terms in local-only notes or pass them as local CLI arguments rather than committing them into the repo.
- **History rewrite decision:** Explicitly deferred; this project’s output is the evidence log (`wip/prune-docs/problematic-removals.md`) to support a later decision.

