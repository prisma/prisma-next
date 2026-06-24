# Dispatch D17 — detect orphaned content-addressed policies in verify (slice `select-policies-dependable`)

Slice 1, TML-2868. Implementer tier: sonnet. Closes the production gap D16 surfaced: removing a policy from the contract must make `db verify` fail naming the orphaned DB policy (slice-1 DoD, option A). Commit your own work.

## The gap (from D16)

`collectExtensionIssues` (`packages/3-targets/6-adapters/postgres/src/core/control-adapter.ts` ~156) early-returns `[]` when the contract declares no policies, so an orphaned DB policy (declared before, now removed) is never diffed. `verifySchema` returns `ok:true`. D16's scenario 2 is marked `it.fails` pending this fix.

## Design (safe orphan detection — no managed/external grading, that's slice 2)

`diffNodes(expectedPolicies, actualPolicies)` already yields `extra` for a DB policy not in the contract. The danger of surfacing ALL extras: a database with externally-managed RLS the user never declared in Prisma would fail verify. Avoid that by only diffing **content-addressed (Prisma-managed)** actual policies:

- An actual policy is **Prisma-managed** iff its wire name equals `<prefix>_<hash-of-its-own-normalized-body>` — i.e. its name suffix is the content hash of its own body. Introspection already recomputes this hash to derive `prefix` (~`control-adapter.ts:1173-1186`); reuse that signal (a recompute, or a flag introspection records). An external policy whose name doesn't match its body-hash is NOT Prisma-managed → excluded → never flagged. (This is near-zero-false-positive; the table-level `managed`/`external` grading that handles the remaining nuance is slice 2.)

**Implementation:**
1. Remove the `expectedPolicies.length === 0` early-return (or restructure so diffing still runs when the contract has no policies but the DB has Prisma-managed ones).
2. Before diffing, filter `actualPolicies` to only those that are content-addressed/Prisma-managed (per the body-hash-matches-name test). Then `diffNodes(expectedPolicies, filteredActualPolicies)` naturally yields: `missing` (declared, absent — existing behavior), `extra` (Prisma-managed orphan, removed from contract — the new behavior), and any `mismatch`.
3. Confirm an `extra` issue flips the verdict: D13 already wires non-empty `extensionIssues → ok:false`, so the orphan → verify fails. Verify this end-to-end.

## Tests

1. **Flip D16 scenario 2** (`rls-lifecycle-e2e.integration.test.ts`) from `it.fails` to `it` — removal now yields `ok:false` + `extensionIssues` naming the orphaned `p_read_<hash>`.
2. **Unit test** for `collectExtensionIssues` (sibling to the existing verify tests): (a) contract with no policy + DB with a Prisma-managed policy → one `extra` issue; (b) contract with no policy + DB with an **external** policy (name NOT matching its body-hash, e.g. `legacy_admin_policy`) → **no** issue (proves external policies aren't flagged); (c) contract+DB matching → clean (regression).
3. Confirm the existing D7 `rls-verify-extension-issues.integration.test.ts` + the walking-skeleton clean-path tests still pass (clean re-verify must stay clean — the applied declared policy is content-addressed and matches, so no spurious extra).

## Gates (run once, foreground)

`pnpm build` → workspace `pnpm typecheck` → the lifecycle e2e (now all green) + the verify unit/integration tests + both walking-skeleton e2es → `pnpm lint:deps` → `pnpm fixtures:check` clean → SQLite + Mongo suites (unchanged — they emit no extension issues).

## Halt conditions (surface)

- Introspection doesn't expose a usable "is content-addressed / body-hash matches name" signal and recomputing it in `collectExtensionIssues` is non-trivial — surface what you found (don't fall back to a bare `^.+_[0-9a-f]{8}$` regex without noting it; the body-hash test is the intended precise check).
- Flagging extras causes the clean-path walking-skeleton re-verify to report spurious drift — surface (means the declared policy isn't matching its own introspected form — a canonicalization bug).

## Constraints

Explicit-staging, `tml-2868:` prefix, no amend, **no push**. No `any`/bare casts in production. Transient-ID scan. Heartbeats to `wip/heartbeats/implementer.txt`.

## Return shape

How you detect Prisma-managed (the body-hash signal + where it comes from), the `collectExtensionIssues` change, the flipped scenario 2 + the external-not-flagged unit test, validation (gates + the removal→ok:false proof), commit SHA, anything surprising. Begin.