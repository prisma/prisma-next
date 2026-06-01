# Learnings — sql-orm-many-to-many

Working ledger of patterns surfaced during this run. Reviewed at close-out; cross-cutting lessons migrate to durable docs.

## Harness lacks subagent resume

This harness exposes no `SendMessage`/resume for spawned subagents — the `Agent` tool always spawns fresh. The `drive-build-workflow` § Subagent continuity default (one persistent implementer + reviewer resumed across dispatches) degrades to its documented fallback: **fresh subagent per dispatch/round with a full-context brief**, with the AC scoreboard + findings carried on-disk via `code-review.md` rather than transcript. Acceptable here because dispatches touch disjoint surfaces (D1 contract / D2 sql-orm-client rename / D3 resolver) and prior work is committed, so the "re-does committed work" failure mode doesn't bite. Worth surfacing upstream: the continuity rule should name on-disk-artifact carry as the first-class fallback, not just "long-lived chat."

## Pre-existing `fixtures:check` env failure

`pnpm fixtures:check` fails at `fixtures:emit` in this sandbox (CLI not on PATH / "Failed to load config" for sql-builder + sql-orm-client emit scripts) — pre-existing, not introduced (matches the TML-2729 gotcha). Additivity is verified instead via a direct golden git-diff (`git diff -- ':(glob)**/contract.json' …`); CI runs the real gate. Don't treat the local `fixtures:check` red as a dispatch failure.

## PGlite/WASM JIT flakiness on broad integration runs

Running the whole sql-orm-client integration suite at once (`cd test/integration && pnpm test test/sql-orm-client/`) can crash with V8 `jit_page.has_value()` (WASM JIT) failures — **pre-existing PGlite/Node env flakiness**, reproduces on the parent branch, not introduced by M:N work. Targeted reruns (per-file, or the same suite again) pass cleanly. Verify integration blast radius with targeted per-file runs; don't trust a single broad-run red.

## Dispatch truncation recovery (no subagent resume)

A substantial dispatch can exhaust the implementer's budget mid-work and return a truncated report with **uncommitted WIP** (happened on the slice-1 read path). Recovery: inspect `git status`/`git diff`, then dispatch a fresh continuation implementer pointed at the WIP with a focused completion brief (it commits the WIP + completion as one commit). Keep dispatches tight and tell implementers to implement-then-test-then-gate rather than over-explore (over-exploration is what burned the budget).
