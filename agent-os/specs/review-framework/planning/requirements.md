# Spec Requirements: Deterministic PR review framework

## Initial Description

Build a deterministic, agent-friendly PR review iteration framework around GitHub review threads and review state:

- Avoid manual one-off shell loops by encoding repeatable analysis steps as CLI scripts.
- Keep a canonical JSON representation of review state (`review-state.json`) and a canonical JSON action plan (`review-actions.json`).
- Make Markdown views deterministic transforms from JSON (e.g. render `review-actions.md` from `review-actions.json`).
- Provide pure scripts for deterministic transforms and summaries (unit-testable, no network).
- Provide explicit side-effect scripts for GitHub administration (reply/react/resolve) that are idempotent and safe to retry, with `--dry-run` defaults.
- Include a reliable workaround for Cursor sandbox TLS/cert errors when running `gh api` (re-run GitHub mutation steps outside the sandbox; never disable TLS verification).

## Requirements Discussion

### First Round Questions

**Q1:** I assume `review-state.json` stays aligned with what `scripts/pr/fetch-review-state.mjs` already emits (unresolved review threads + submitted reviews + PR issue comments). Is that correct, or do you want to expand/trim it (e.g. include resolved/outdated threads, include diff hunk context)?  
**Answer:** Correct. That script is intended exclusively for this workflow; we can relocate/colocate it with the rest of the skill, and we can change its implementation/output structure as needed for this framework. The baseline scope is correct.

**Q2:** For idempotent GitHub admin, I’m assuming we standardize on a single canonical identifier per target. Do we want to use GraphQL node ids for mutations (and keep `databaseId` only for display/debug)? Also: `fetch-review-state` currently has comment `id` and `databaseId` but `nodeId` is `null` — should we drop `nodeId` and treat `id` as the node id, or explicitly add a real `nodeId` field?  
**Answer:** Use GraphQL node ids. Pick one ID; `databaseId` is not needed.

**Q3:** For `review-actions.json`, I’m assuming we’ll formalize allowed enums. What are the allowed values for `decision` and `status`?  
**Answer:** The proposed `decision` enum looks good, but if we include `wont_address` it needs to be super clear that feedback with rationale is required. Prefer dropping `wont_address` in favor of explicit reasons like `defer` (and similar “wont address” reason codes).

**Q4:** Should an action be able to target only review threads, or also individual thread comments, submitted reviews, and PR issue comments?  
**Answer:** All of the above.

**Q5:** For idempotency, I’m assuming we’ll use markers for replies, “ensure my 👍 exists” for reactions, and “skip if already resolved” for threads. Is that the right model?  
**Answer:** Keep it simple: if a review thread is not resolved, we should still target it. If a standalone comment has a “Done” comment from us, it’s considered resolved.

**Q6:** When `apply-review-actions.mjs` succeeds, should it write back into `review-actions.json` or emit a separate log/artifact?  
**Answer:** Don’t care.

**Q7:** On TLS/cert failures from `gh api` in sandbox (e.g. `x509: OSStatus -26276`), do you want a distinct exit code / specific stderr guidance?  
**Answer:** Don’t care.

### Existing Code to Reference

**Similar Features Identified:**
- Feature: Fetch review state (deterministic Markdown + JSON) - Path: `scripts/pr/fetch-review-state.mjs`
- Feature: Render actions Markdown deterministically from JSON - Path: `scripts/pr/render-review-actions.mjs`
- Workflow prompts/agents to align with:
  - `.claude/agents/agent-os/review-triager.md`
  - `.claude/agents/agent-os/review-implementer.md`
  - `.claude/skills/github-review-iteration/SKILL.md`
- Cursor environment rule to reference:
  - `.cursor/rules/github-cli-tls-in-sandbox.mdc`

### Follow-up Questions

No follow-up questions.

## Visual Assets

### Files Provided:

No visual assets provided.

## Requirements Summary

### Functional Requirements

- Produce and consume **canonical** artifacts:
  - `review-state.json` (canonical; fetched state)
  - `review-actions.json` (canonical; triage/work tracking)
- Treat Markdown views as **derived** outputs:
  - `review-actions.md` is a deterministic transform from `review-actions.json`
- Support targeting actions against:
  - review threads
  - review-thread comments
  - submitted reviews
  - PR issue comments
- Use a single canonical id for targets: **GraphQL node ids**
- Idempotent “admin” semantics:
  - unresolved review threads remain in scope until resolved
  - standalone comment considered resolved if there is a “Done” comment from the current user
- Sandbox TLS handling:
  - if `gh api` fails with TLS/cert errors, re-run outside sandbox (never disable TLS)

### Reusability Opportunities

- Reuse deterministic sorting/output patterns from `scripts/pr/fetch-review-state.mjs`.
- Reuse pure transformation approach used by `scripts/pr/render-review-actions.mjs`.
- Reuse the existing triager/implementer roles but constrain them to the deterministic artifact pipeline.

### Scope Boundaries

**In Scope:**
- Local-only, deterministic CLI tooling and artifact contracts for review iteration.
- GitHub administration script(s) that are explicitly invoked and idempotent.

**Out of Scope:**
- CI integration.
- Fully automatic triage decisions.
- Cross-repo generalization beyond this repository’s conventions.

### Technical Considerations

- Prefer GraphQL node ids as the one canonical identifier everywhere.
- Prefer pure scripts (unit tested) for transforms/summaries; keep side effects in a dedicated admin script with `--dry-run` default.
- Allow relocating/adjusting `fetch-review-state` implementation/output to better serve the framework (it is workflow-specific).

