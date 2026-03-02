# Code Review Fixes Plan

## Summary

Address the five issues (F01–F05) identified in the PR #184 code review (`projects/on-disk-migrations/reviews/pr-184/code-review.md`) and the system design review. Two are blocking (F01, F02) — they weaken integrity guarantees at the filesystem trust boundary. Three are non-blocking (F03–F05) — documentation drift and edge-case UX.

**Spec:** `projects/on-disk-migrations/spec.md`

## Collaborators

| Role | Person/Team | Context |
|---|---|---|
| Maker | Agent | Drives execution |
| Reviewer | Sævar Berg | PR author, architectural review |

## Milestones

### Milestone 1: Blocking integrity fixes (F01, F02)

These two issues weaken the trust boundary between on-disk artifacts and runtime execution. Both are small, focused changes with clear acceptance criteria.

**Tasks:**

- [ ] **F01 — marker reconciliation when no attested migrations exist**
  - In `migration-apply.ts`, before the `packages.length === 0` early-return, connect to the DB and read the marker
  - If the marker is non-empty (`storageHash !== EMPTY_CONTRACT_HASH`), return an error: the DB has state that no known migration can explain
  - If the marker is empty, return the current no-op success
  - Add unit test: no attested migrations + non-empty DB marker → error
  - Add e2e test: `db init` → delete migrations dir → `migration apply` → expect error (not silent success)

- [ ] **F02 — harden `edgeId` validation and attested filtering**
  - In `validateManifest()` (`migration/src/io.ts`), validate `edgeId` is present and is `string | null` — reject `undefined` or other types
  - In `migration-apply.ts` and `migration-plan.ts`, change attested filtering from `p.manifest.edgeId !== null` to `typeof p.manifest.edgeId === 'string'`
  - Add unit test in `io.test.ts`: manifest with missing `edgeId` → throws
  - Add unit test in `io.test.ts`: manifest with `edgeId: 123` (wrong type) → throws
  - Add unit test: confirm `typeof edgeId === 'string'` filtering excludes `undefined`

### Milestone 2: Non-blocking fixes (F03, F04, F05)

Documentation drift and edge-case UX improvements. Lower priority but should be addressed before merge.

**Tasks:**

- [ ] **F03 — fix `migration verify` remediation text**
  - Change the fix text from `'Re-attest with \`migration verify\`...'` to guidance that actually works: `'Set edgeId to null in migration.json, then rerun \`migration verify\` to re-attest.'`
  - `migration verify` only auto-attests drafts (`edgeId: null`); the current text suggests re-running verify will fix a mismatch, but it won't — it will just report the same mismatch again

- [ ] **F04 — update project docs to reflect destructive behavior**
  - Update `spec.md` non-goals section (line 109): remove "MVP is additive-only" language, note that `migration plan` now accepts all operation classes the planner can produce
  - Update `spec.md` RD-17: remove references to hardcoded additive-only policy in `migration plan`
  - Update `user-stories.md`: mark `migration apply` as implemented, remove "does not exist yet" language
  - Update `plan.md` open items: remove "currently hardcoded to additive only" note

- [ ] **F05 — remove `migration new` command**
  - Delete `packages/1-framework/3-tooling/cli/src/commands/migration-new.ts`
  - Remove CLI registration from `cli.ts`
  - Remove `tsdown.config.ts` entry and `package.json` exports
  - Remove unit tests for `migration-new`
  - Remove references in CLI README
  - Update spec FR-8 to note removal (the command scaffolds unusable placeholders — users need correct hashes, contracts, and ops which they can't realistically provide)
  - This also resolves the PR reviewer's blocking comment about `migration new` being documented as public but effectively unusable

### Milestone 3: Close-out

**Tasks:**

- [ ] Run `pnpm test:packages` and `pnpm lint:deps` — all pass
- [ ] Verify the two blocking fixes have test coverage
- [ ] Update `plan.md` to reflect completed review fixes

## Test Coverage

| Acceptance Criterion | Test Type | Task/Milestone | Notes |
|---|---|---|---|
| `migration apply` errors when no attested migrations but DB marker is non-empty | Unit + E2E | F01 / M1 | New test |
| `migration apply` succeeds when no attested migrations and DB marker is empty | Unit | F01 / M1 | Existing behavior, add explicit test |
| `validateManifest` rejects missing `edgeId` | Unit | F02 / M1 | New test |
| `validateManifest` rejects wrong-type `edgeId` | Unit | F02 / M1 | New test |
| Attested filtering uses `typeof === 'string'` | Unit | F02 / M1 | New test |
| `migration verify` fix text is actionable | Manual | F03 / M2 | Verify text in output |
| Spec/docs reflect destructive behavior | Manual | F04 / M2 | Read-through verification |
| `migration new` command removed | Manual | F05 / M2 | Verify CLI registration, exports, tests removed |

## Open Items

- F01 requires a database connection even in the "no migrations" path. This changes the command's behavior from "exits immediately" to "connects then exits." This is the correct behavior (the command should always reconcile marker state), but it means `migration apply` with an unreachable database will fail differently when there are no migrations. This is acceptable — a misconfigured DB connection should surface early.
