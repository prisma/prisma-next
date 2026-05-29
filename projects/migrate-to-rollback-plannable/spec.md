# Slice: plannable-rollback-edge

> Standalone slice (TML-2690). No multi-slice project; this directory is the
> tracked home for the slice spec. The spec content is injected into the PR
> description at PR-open time.

## At a glance

Make a rollback (or any arbitrary-target) migration plannable as one command by
adding `--to <ref>` (and explicit `--from <ref>`) to `prisma-next migration
plan`, and rewrite the `migrate --to` `pathUnreachable` diagnostic so it points
the user at that exact command. Closes the gap where `migrate --to <dir>^` is
advertised in `--help` but dead-ends, forcing a three-command contract-surgery
workaround (TML-2690).

## Chosen design

Three coordinated changes, one reviewable unit:

**1. `migration plan --to <contract>` (the core change).** Today
`migration-plan.ts` hard-wires the planner destination to the emitted
`contract.json` (`resolveContractPath(config)`, and `end-contract.json` copied
from `getEmittedArtifactPaths(...)`). Add an optional `--to <contract>` accepting
the **same reference grammar** `--from` already accepts (hash / prefix / ref name
/ migration dir / `<dir>^` / `./path`), resolved by `parseContractRef`. When
supplied, the resolved contract becomes the planner destination and the source of
`end-contract.json` / `.d.ts`; the no-op check runs against the resolved hash.
When omitted, behavior is byte-identical to today (emitted contract is the
destination).

**2. Generalize ref→contract resolution.** `resolveFromForPlan`
(`plan-resolution.ts`, landed with TML-2629) already resolves a reference to
`{ hash, contract, contractJson, contractDts }` via `parseContractRef` →
ref-name / graph-node / snapshot materialization. Extract that core into a shared
resolver reused by both `--from` and `--to`. The greenfield / auto-baseline
branches stay `--from`-only.

**3. Diagnostic coherence.** `errorPathUnreachable` (`cli-errors.ts`) *already*
emits a `fix` of `migration plan --from <fromHash> --to <targetHash>` — but that
command doesn't exist yet, so the advice is currently a dead end. Change #1 makes
the existing advice true. Tighten `buildPathNotFoundFailure.why`
(`control-api/operations/migration-apply.ts`) so `why` + `fix` read as one
sequence: no edge from `<current>` to `<target>` → plan one with `migration plan
--from <current> --to <target> --name <slug>` → re-run `migrate --to <target>`,
with a one-line note that a rollback plan is expected to contain destructive
(`DROP`) ops to review before applying.

Worked example (the J5 audit's failing case, after this slice):

```
$ prisma-next migrate --to 20260522T1240_add_comment_model^ --db $DATABASE_URL
# refuses: no edge from <comment_hash> to <baseline_hash>.
# fix: prisma-next migration plan --from 20260522T1240_add_comment_model \
#        --to 20260522T1240_add_comment_model^ --name drop_comment_model
$ prisma-next migration plan --from 20260522T1240_add_comment_model \
    --to 20260522T1240_add_comment_model^ --name drop_comment_model
# plans comment_hash -> baseline_hash, one DROP TABLE op, flagged (destructive)
$ prisma-next migrate --to 20260522T1240_add_comment_model^ --db $DATABASE_URL
# applies; marker moves back to baseline_hash
```

No contract-source edit. `migrate` keeps refusing to invent a path (correct
invariant); the reverse edge becomes a real, committable migration package on
disk.

## Coherence rationale

The error message and the `--to` flag are one change, not two: rewriting the
diagnostic to advertise `migration plan --to` is meaningless until the flag
exists, and shipping the flag without fixing the diagnostic leaves the
advertised-but-broken `<dir>^` trap in place. One reviewer holds "the rollback
edge is now plannable, and the error that sends you there is honest" in a single
sitting.

## Scope

**In:**

- `packages/1-framework/3-tooling/cli/src/commands/migration-plan.ts` — register
  + wire `--to`; explicit `--from` already exists.
- `packages/1-framework/3-tooling/cli/src/utils/plan-resolution.ts` — extract
  shared ref→contract resolver.
- `packages/1-framework/3-tooling/cli/src/utils/cli-errors.ts`
  (`errorPathUnreachable`) and `control-api/operations/migration-apply.ts`
  (`buildPathNotFoundFailure.why`) — diagnostic coherence.
- Tests + fixtures for the above; `migration plan` help text; `docs/architecture
  docs/subsystems/7. Migration System.md` (`migration plan` synopsis + § Recovery
  affordances) and `@prisma-next/cli` README.

**Out:**

- Auto-planning a reverse edge inside `migrate --to` (rejected by design — keep
  the refusal invariant).
- Empty-graph special-casing for `--to` (decided: `--to` only swaps the
  destination; `--from`/auto-baseline resolution untouched).
- Any source-drift reminder in `migration plan --to` output (decided: out — the
  user chose the endpoints).
- Squash / branch-tip ambiguity changes; the existing `AMBIGUOUS_TARGET`
  behavior is unchanged.

## Pre-investigated edge cases

| Edge case | Disposition | Notes |
|---|---|---|
| Reverse delta is destructive (`DROP TABLE`/`DROP COLUMN`) | **In scope, no refusal** | `migration plan`'s policy allows the `destructive` op class (unlike `db init`'s additive-only policy), so a clean rollback plans successfully today with a "may cause data loss" warning. The feared `migrate refuses → plan refuses` double-dead-end does **not** occur for the common rollback. |
| Reverse delta needs rename inference / NOT-NULL re-add without a safe default / type change needing data | **Acknowledge in copy, don't solve** | These narrower cases *can* still make the planner fail fast for a hint. The diagnostic should acknowledge "a rollback may need a hint" rather than promise a frictionless path in every case. |

## Slice-specific done conditions

- [ ] An e2e/CLI test reproduces the J5 audit case: from a two-migration applied
      state, `migration plan --to <dir>^` emits a reverse package and `migrate
      --to <dir>^` then succeeds — no contract-source edit.

## Open Questions

None outstanding — both prior design decisions resolved with the operator (no
empty-graph special case; no source-drift note). The destructive-op message
wording is a dispatch-time copy detail, not a design fork.

## References

- Linear issue: [TML-2690](https://linear.app/prisma-company/issue/TML-2690)
- Related (merged): TML-2629 — refs auto-management + auto-baseline; its
  `resolveFromForPlan` / snapshot machinery is the reuse base for `--to`.
- ADRs: ADR 001 — Migrations as Edges (reverse/cyclic edges are valid graph
  shapes), ADR 039 — Migration graph path resolution, ADR 218 — Refs with paired
  contract snapshots. No new ADR — this adds a flag and tightens copy; it doesn't
  shift the edge/graph model.
