# Learnings — sql-orm-many-to-many

Working ledger of patterns surfaced during this run. Reviewed at close-out; cross-cutting lessons migrate to durable docs.

## Harness lacks subagent resume

This harness exposes no `SendMessage`/resume for spawned subagents — the `Agent` tool always spawns fresh. The `drive-build-workflow` § Subagent continuity default (one persistent implementer + reviewer resumed across dispatches) degrades to its documented fallback: **fresh subagent per dispatch/round with a full-context brief**, with the AC scoreboard + findings carried on-disk via `code-review.md` rather than transcript. Acceptable here because dispatches touch disjoint surfaces (D1 contract / D2 sql-orm-client rename / D3 resolver) and prior work is committed, so the "re-does committed work" failure mode doesn't bite. Worth surfacing upstream: the continuity rule should name on-disk-artifact carry as the first-class fallback, not just "long-lived chat."

## Pre-existing `fixtures:check` env failure

`pnpm fixtures:check` fails at `fixtures:emit` in this sandbox (CLI not on PATH / "Failed to load config" for sql-builder + sql-orm-client emit scripts) — pre-existing, not introduced (matches the TML-2729 gotcha). Additivity is verified instead via a direct golden git-diff (`git diff -- ':(glob)**/contract.json' …`); CI runs the real gate. Don't treat the local `fixtures:check` red as a dispatch failure.
