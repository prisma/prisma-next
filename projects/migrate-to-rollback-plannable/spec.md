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

## Dispatch plan

### Dispatch 1: `migration plan --to <contract>`

- **Outcome:** `prisma-next migration plan` accepts an optional `--to <contract>`
  (same reference grammar as `--from`, resolved via `parseContractRef`) and plans
  toward the resolved contract instead of the emitted `contract.json`; with `--to`
  omitted, behaviour is byte-identical to today. The ref→contract resolution core
  of `resolveFromForPlan` is generalized so both `--from` and `--to` share it
  (greenfield / auto-baseline branches stay `--from`-only). Test-first: failing
  CLI/integration tests for reverse-delta emission (DROP ops + destructive
  warning), `--to` + explicit `--from`, and default-preservation land before the
  implementation.
- **Builds on:** the spec's chosen design; the merged TML-2629 `resolveFromForPlan`
  / snapshot-materialization machinery.
- **Hands to:** a `migration plan --to <ref>` that emits a committable
  arbitrary-target (incl. reverse/rollback) migration package; the `--to` flag and
  its `--help` string exist.
- **Focus:** `migration-plan.ts` (`--to` registration + destination wiring),
  `plan-resolution.ts` (shared resolver extraction). Not the `migrate`-side
  diagnostics (Dispatch 2) or docs/fixtures (Dispatch 3).

### Dispatch 2: `pathUnreachable` diagnostic coherence

- **Outcome:** `migrate --to`'s `MIGRATION.PATH_UNREACHABLE` / `PN-RUN-3000`
  diagnostic reads as one plan-then-apply sequence — `why` (no edge from
  `<current>` to `<target>`) + `fix` (`migration plan --from <current> --to
  <target> --name <slug>`, then re-run `migrate --to <target>`) — including the
  one-line note that a rollback plan is expected to contain destructive (`DROP`)
  ops to review, and acknowledging that narrower cases (rename / NOT-NULL re-add /
  type change) may need a hint. The advertised command now actually works (built in
  Dispatch 1). Tests assert the message chain.
- **Builds on:** Dispatch 1's `migration plan --to` (the command the `fix` text
  advertises must exist).
- **Hands to:** a coherent end-to-end recovery story: the `migrate` refusal points
  at a real, working command sequence.
- **Focus:** `cli-errors.ts` (`errorPathUnreachable`) and
  `control-api/operations/migration-apply.ts` (`buildPathNotFoundFailure.why`). Not
  the planner behaviour (Dispatch 1).

### Dispatch 3: docs + fixtures (+ `neverPlanned` `why` coherence)

- **Outcome:** `docs/architecture docs/subsystems/7. Migration System.md`
  (`migration plan` synopsis + § Recovery affordances table) and the
  `@prisma-next/cli` README reflect `--to`; `pnpm fixtures:check` is green
  (CLI-help / command snapshots regenerated for the new flag). Additionally, the
  sibling `neverPlanned` diagnostic's own `why` (`buildNeverPlannedFailure` in
  `control-api/operations/migration-apply.ts`) no longer redundantly tells the
  user to "run migration plan" now that D2's shared `fix` owns the recovery — the
  two compose non-redundantly the same way the `pathUnreachable` branch does.
- **Builds on:** Dispatch 1 (flag + help string) and Dispatch 2 (diagnostic text)
  — both feed snapshot fixtures and the docs.
- **Hands to:** slice-DoD met — feature, honest diagnostics (both branches),
  current docs, green fixtures.
- **Focus:** docs + README + fixture regen + the one-line `neverPlanned` `why`
  edit (folded from review item E1) with a test assertion. No planner/behavioural
  change.

> **E1 resolution (orchestrator decision).** Review of D2 surfaced that the
> `neverPlanned` branch's `why` carries the same redundancy D2 removed from the
> `pathUnreachable` branch. Folded into D3 as a one-line message edit rather than
> a separate round — same diagnostic-coherence goal, trivially related.

## Open items

- **Pre-existing CLI spawn-timeout flakes (not this slice).** Nine `@prisma-next/cli`
  tests (`version.test.ts`, `removed-verb-redirects.test.ts`,
  `no-parallel-ci-detection.test.ts`) `spawnSync` the built `dist/cli.mjs` and hit
  the 500ms `vitestPackageDefault` cap against a ~680ms cold start — a structural
  config mismatch pre-dating this work. Out of scope here; candidate follow-up:
  raise the timeout for these spawn tests or move them to the e2e suite.
