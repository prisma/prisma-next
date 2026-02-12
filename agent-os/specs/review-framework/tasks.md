---
title: "Task Breakdown: Deterministic PR review framework (GitHub review iteration)"
date: 2026-02-12
spec: agent-os/specs/review-framework/spec.md
---

# Task Breakdown: Deterministic PR review framework (GitHub review iteration)

## Overview

This tasks list is specific to the **deterministic PR review framework for GitHub reviews** described in `agent-os/specs/review-framework/spec.md`.

Total Task Groups: 6  
Total Checkboxes: 49

Key constraints (from spec):
- **Node IDs only**: GraphQL `nodeId` is the *only* canonical identifier (never require `databaseId`).
- **Deterministic artifacts**: stable ordering + stable formatting (2-space JSON indent, trailing newline).
- **Pure scripts**: render/summarize are unit-testable with `node --test`, no network.
- **Mutation scripts**: idempotent, retry-safe, and **`--dry-run` by default**.
- **TLS/cert failures in sandbox**: fail fast, instruct to rerun outside sandbox; never disable TLS verification.

## Task List

### Artifact + schema alignment

#### Task Group 1: Canonical artifacts (v1) + normalization utilities
**Dependencies:** None

- [x] 1.0 Align artifact shapes + normalization rules with the spec
  - [x] 1.1 Define v1 shapes for `review-state.json` and `review-actions.json` in code (types + runtime validation)
    - Ensure `version: 1` is required and upgrade behavior is explicit (reject unknown versions for now)
    - Ensure all targets use **GraphQL node ids** only (`nodeId` fields; no `databaseId` requirements)
  - [x] 1.2 Implement deterministic sorting/normalization utilities for `review-state.json` v1
    - Thread sorting: `(path ASC, startLine ASC, earliestCommentCreatedAt ASC, nodeId ASC)`
    - Comment sorting: `(createdAt ASC, nodeId ASC)`
    - Review sorting: `(submittedAt ASC, nodeId ASC)`
    - Issue comment sorting: `(createdAt ASC, nodeId ASC)`
    - Reaction groups normalized to counts-only and sorted by `content ASC`
  - [x] 1.3 Implement marker stripping for comment/review bodies when writing `review-state.json`
    - Strip `<!-- review-framework:... -->` markers from bodies (do not pollute diffs)
  - [x] 1.4 Update `scripts/pr/fetch-review-state.mjs` to emit canonical `review-state.json` v1
    - Keep baseline scope: unresolved threads + submitted reviews with body + PR issue comments
    - Ensure it does not require `databaseId` and does not emit `nodeId: null`
    - Keep Markdown as derived output (JSON-first)
  - [x] 1.5 Add fixtures that represent `review-state.json` v1 and `review-actions.json` v1 (small, stable, committed)
  - [x] 1.6 Add `node --test` tests for the **pure** normalization/validation utilities (no network)
    - Golden assertions for stable ordering + reaction group normalization + marker stripping
    - Command: `node --test scripts/pr/**/*.test.mjs`
  - [x] 1.7 Verify deterministic JSON formatting
    - Ensure `JSON.stringify(value, null, 2) + '\n'` behavior is consistent wherever artifacts are written
  - [x] 1.8 Verify CLI contracts for fetch script (help, exit codes, stderr vs stdout)
    - Commands:
      - `node scripts/pr/fetch-review-state.mjs --help`
      - (manual) `node scripts/pr/fetch-review-state.mjs --pr <url> --out-json -`

**Acceptance Criteria:**
- `review-state.json` and `review-actions.json` are validated against explicit v1 schemas in code.
- Normalization utilities produce **byte-for-byte stable output** for the same input.
- `fetch-review-state` emits **node-id-only** canonical `review-state.json` v1 (no `databaseId` dependency; no `nodeId: null`).
- Pure utility tests pass via `node --test scripts/pr/**/*.test.mjs`.

---

### Pure scripts (summarize/render)

#### Task Group 2: Deterministic renders + summaries (no network)
**Dependencies:** Task Group 1

- [ ] 2.0 Implement pure, deterministic render/summarize tooling for review artifacts
  - [ ] 2.1 Add `scripts/pr/render-review-state.mjs` (pure) to render `review-state.md` from `review-state.json`
    - Stable order derived from `review-state.json` (no re-sorting beyond trusting canonical JSON)
    - Ensure bodies are marker-free (already stripped in canonical JSON) and output is UTF-8 + trailing newline
  - [ ] 2.2 Add `scripts/pr/summarize-review-state.mjs` (pure) with the spec CLI contract
    - `--format text|json` (default `text`), stable ordering, trailing newline rules
  - [ ] 2.3 Update/align `scripts/pr/render-review-actions.mjs` to match v1 `review-actions.json` guidance
    - Do not depend on `wont_address`; prefer explicit reason codes (`defer`, `out_of_scope`, `already_fixed`, `not_actionable`)
    - Preserve `actions[]` order as written in JSON; may filter but **must not reorder**
    - Ensure table safety (escape `|`, collapse newlines/whitespace within cells)
  - [ ] 2.4 Add deterministic fixtures + golden outputs for all pure scripts
    - `review-state.json` → `review-state.md` golden file
    - `review-actions.json` → `review-actions.md` golden file
    - `review-state.json` → `summary.txt` (and/or `summary.json`) golden file
  - [ ] 2.5 Add `node --test` unit tests asserting exact outputs (including trailing newline)
    - Command: `node --test scripts/pr/**/*.test.mjs`
  - [ ] 2.6 Verify each pure script’s CLI contract
    - Commands:
      - `node scripts/pr/render-review-state.mjs --help`
      - `node scripts/pr/render-review-actions.mjs --help`
      - `node scripts/pr/summarize-review-state.mjs --help`
  - [ ] 2.7 Verify “same input → same bytes” behavior across runs
    - Run render/summarize twice and confirm files are identical (manual check acceptable)

**Acceptance Criteria:**
- `render-review-state`, `render-review-actions`, and `summarize-review-state` are **pure** (no network) and deterministic.
- `node --test scripts/pr/**/*.test.mjs` passes with golden output comparisons.
- CLI flags and defaults match the spec (including `--help` behavior and exit codes).

---

### GitHub mutation tooling (idempotent apply)

#### Task Group 3: `apply-review-actions` (network) with a pure planner + idempotent semantics
**Dependencies:** Task Groups 1–2

- [ ] 3.0 Implement idempotent GitHub mutation tooling for review administration
  - [ ] 3.1 Implement a **pure planner** for `apply-review-actions`
    - Input: `review-actions.json` (+ optional `review-state.json`) + `viewer.login` + current GitHub state (as provided to planner)
    - Output: a deterministic operations list (resolve/reply/react/noop) suitable for dry-run printing and execution
  - [ ] 3.2 Encode the spec’s simplified idempotency rule in the planner
    - Review threads: remain in scope while `isResolved === false`
    - Standalone comments: considered resolved if there is a “Done” comment from **current user**
  - [ ] 3.3 Implement marker-based “ensure reply” semantics
    - Use a hidden marker like `<!-- review-framework:actionId=A-001 kind=done -->`
    - Apply checks marker (or exact body match rule) before posting to avoid duplicates
  - [ ] 3.4 Implement “ensure reaction” semantics (node-id-only)
    - Add reaction only if current user does not already have it
  - [ ] 3.5 Implement “ensure thread resolved” semantics (node-id-only)
    - Resolve only if currently unresolved
  - [ ] 3.6 Implement `scripts/pr/apply-review-actions.mjs` (network executor wrapper)
    - Default is **`--dry-run`**; `--apply` must be explicit
    - Support `--format text|json` for printing planned/executed ops
    - Ensure exit codes: `0` success/no-op; `1` operational error; `2` usage error
  - [ ] 3.7 Implement TLS/cert fail-fast handling aligned with `.cursor/rules/github-cli-tls-in-sandbox.mdc`
    - Detect common TLS/cert errors from `gh api` failures (e.g. `x509: OSStatus -26276`)
    - Print guidance to stderr: rerun outside sandbox; never disable TLS verification
  - [ ] 3.8 Add `node --test` unit tests for the planner (no network)
    - Covers: unresolved thread semantics; standalone “Done” detection; marker detection; ensure/noop behavior; stable operation ordering
    - Command: `node --test scripts/pr/**/*.test.mjs`
  - [ ] 3.9 Add a minimal manual verification checklist for the executor (requires real PR)
    - Dry run: `node scripts/pr/apply-review-actions.mjs --in <review-actions.json> --dry-run`
    - Apply: `node scripts/pr/apply-review-actions.mjs --in <review-actions.json> --apply`
    - Re-run apply and confirm idempotent no-ops
  - [ ] 3.10 Decide how to record apply results
    - Either write back into `review-actions.json` `done.githubAdmin` or emit a derived `apply-log.json` (both acceptable per spec)

**Acceptance Criteria:**
- `apply-review-actions` is **safe to retry** and **idempotent** (re-running yields no duplicate replies/reactions and does not error on already-resolved threads).
- Default is `--dry-run`; `--apply` is required for mutations.
- Planner logic is fully unit-tested via `node --test` (no network).
- TLS/cert failures fail fast and provide the correct rerun guidance (no TLS disabling).

---

### Orchestration updates (skills/agents)

#### Task Group 4: Update Agent OS orchestration (triage/implement loop)
**Dependencies:** Task Groups 1–3

- [ ] 4.0 Align agents/skills with the deterministic artifacts + CLI contracts
  - [ ] 4.1 Update `.claude/skills/github-review-iteration/SKILL.md` to use JSON-first canonical artifacts + derived Markdown views
    - Explicitly reference new/updated commands for fetch, render, summarize, apply (dry-run → apply)
  - [ ] 4.2 Update `.claude/agents/agent-os/review-triager.md` to author `review-actions.json` v1 deterministically
    - Ensure it uses node ids for all targets and preserves `actions[]` order intentionally
  - [ ] 4.3 Update `.claude/agents/agent-os/review-implementer.md` to update action statuses (`pending|in_progress|done`) and completion records
  - [ ] 4.4 Ensure the standard storage layout is used under `agent-os/specs/review-framework/reviews/<owner>_<repo>_pr-<number>/`
    - Ensure directory naming is deterministic from PR URL
  - [ ] 4.5 Add a thin orchestration wrapper only if it reduces steps without adding nondeterminism
    - Optional script: `scripts/pr/review-iterate.mjs` (must be explicit about what it reads/writes)
  - [ ] 4.6 Smoke-test the loop end-to-end on one real PR (manual)
    - Fetch → render/summarize → triage → render actions → dry-run apply → apply → re-fetch

**Acceptance Criteria:**
- Agents/skill guidance consistently produces/consumes v1 artifacts and uses **nodeId-only** identifiers.
- The recommended loop matches the spec, including dry-run-first mutation behavior.
- Review artifacts live in the deterministic `reviews/<owner>_<repo>_pr-<number>/` layout.

---

### Docs / rules alignment

#### Task Group 5: Documentation + rule alignment for the framework and Cursor sandbox constraints
**Dependencies:** Task Groups 1–4

- [ ] 5.0 Ensure documentation and rules are consistent, discoverable, and non-contradictory
  - [ ] 5.1 Update `scripts/pr/README.md` to document the framework workflow and script contracts
    - Include JSON-first artifacts, derived Markdown, and example command lines
  - [ ] 5.2 Ensure `.cursor/rules/github-cli-tls-in-sandbox.mdc` matches the spec guidance
    - Rerun outside sandbox; never disable TLS verification; fail fast
  - [ ] 5.3 Update `.cursor/rules/README.md` to index the TLS rule and any new review-framework rules/docs
  - [ ] 5.4 Update/extend spec docs if implementation requires clarifying decisions (schemas, markers, apply logging)
    - Keep contracts stable and versioned
  - [ ] 5.5 Add a short “artifact contract quick reference” section (node ids, sorting, formatting, markers)
  - [ ] 5.6 Verify docs reflect the actual CLI flags and defaults (help output stays accurate)

**Acceptance Criteria:**
- Docs describe the same CLI contracts and semantics that the scripts implement.
- TLS/cert guidance is consistent between spec and Cursor rules.
- Developers can follow a single README workflow to run the loop locally.

---

### Tests + repo-level verification

#### Task Group 6: Test coverage + integration checks for determinism and layering
**Dependencies:** Task Groups 1–5

- [ ] 6.0 Confirm the framework is testable, deterministic, and repo-aligned
  - [ ] 6.1 Run all script unit tests (pure + planner)
    - Command: `node --test scripts/pr/**/*.test.mjs`
  - [ ] 6.2 Run repo typecheck (where relevant)
    - Command: `pnpm typecheck`
  - [ ] 6.3 Run repo lint (where relevant)
    - Command: `pnpm lint`
  - [ ] 6.4 Validate architectural boundaries (where relevant)
    - Command: `pnpm lint:deps`
  - [ ] 6.5 Run package tests (optional but recommended before landing changes)
    - Command: `pnpm test:packages`
  - [ ] 6.6 Manual determinism check on artifacts
    - Re-run pure scripts twice and confirm byte-identical outputs
    - Confirm `apply-review-actions` dry-run output is stable (same planned operations for same inputs)

**Acceptance Criteria:**
- `node --test scripts/pr/**/*.test.mjs` passes locally.
- Repo-level checks pass (`pnpm typecheck`, `pnpm lint`, `pnpm lint:deps`; optionally `pnpm test:packages`).
- Determinism is demonstrated for render/summarize outputs and dry-run planned operations.

## Execution Order

Recommended implementation sequence (dependencies-first):
1. Task Group 1 — Artifact/schema alignment + normalization utilities
2. Task Group 2 — Pure render/summarize scripts + golden tests
3. Task Group 3 — Idempotent apply tooling (pure planner first, then executor)
4. Task Group 4 — Orchestration updates (skills/agents)
5. Task Group 5 — Docs/rules alignment
6. Task Group 6 — Tests + repo verification

