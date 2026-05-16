# Route on-disk contract reads through the serializer seam

## Summary

Replace every `JSON.parse(...) as Contract` cast in the CLI with `validateContract` through `familyInstance`, strip the SQL family's silent shape-coercion in `normaliseTypeEntry`, regenerate the demo's `start-/end-contract.json` files under the strict deserializer, rewrite the misleading normalisation rule + add an `as Contract` smell rule, add a grep-based CI lint to keep the bypass class closed, and close the test gap by per-kind fixtures + adding the demo's CLI workflow to CI. Closes TML-2536.

**Spec:** `projects/tml-2536-contract-deserializer-seam/spec.md`
**Plan:** `projects/tml-2536-contract-deserializer-seam/plans/plan.md`

## Collaborators

| Role | Person/Team | Context |
| --- | --- | --- |
| Maker | William Madden | Drives execution |
| Reviewer | Terminal team (PR review) | Contract-seam architecture; demo regen |
| Related | TML-2512 | Already consolidated snapshot reads into `readPredecessorEndContract`; this PR layers on top |
| Related | TML-2537 | Owns the family-core layering cleanup; out of scope here |
| Related | TML-2515 | Owns the back-compat-policy question; this PR explicitly assumes "no back-compat" until then |

## Shipping Strategy

Single PR, single milestone. The change is intertwined enough that splitting it across PRs leaves the demo broken in an intermediate state: stripping `normaliseTypeEntry`'s fallthrough invalidates the old `end-contract.json` files immediately, so demo regeneration has to land together. Commits are sequenced so each individual commit leaves typecheck green; the demo CI job is added last so it doesn't fail until the regeneration commit lands.

The PR is shippable to `main` after CI passes. No deployment coordination — this is a CLI internal-hygiene change with no consumers outside the monorepo.

## Test Design

| AC | TC | Test Case | Type | Milestone | Expected Outcome |
| --- | --- | --- | --- | --- | --- |
| AC-1 | TC-1 | `readPredecessorEndContract` return type is the hydrated `Contract`; no `as Contract` in its body | Type-level + grep | M1 | TS compiles; grep finds zero matches in the function |
| AC-2 | TC-2 | `JSON.parse(...) as Contract` absent from `packages/**/src/**` | Grep | M1 | Zero matches |
| AC-2 | TC-3 | `migration plan`, `migration new`, `migration apply`, `migration show`, `db-verify` each route on-disk contract reads through `familyInstance.validateContract` | Code-level (review + grep for `validateContract` calls at the new sites) | M1 | All five sites converted |
| AC-3 | TC-4 | `normaliseTypeEntry` rejects an untagged codec triple with a diagnostic naming the offending entry | Unit | M1 | Throws; error message includes the entry name |
| AC-3 | TC-5 | `normaliseTypeEntry` still accepts a tagged `codec-instance` entry and a `postgres-enum` entry | Unit | M1 | Both round-trip |
| AC-4 | TC-6 | `pnpm prisma-next migration plan` against `examples/prisma-next-demo` is a no-op (does not crash) | E2E (CI job) | M1 | Exit 0; no diff |
| AC-5 | TC-7 | Demo `start-/end-contract.json` files validate under the strict serializer | Snapshot (parse each file and call `familyInstance.validateContract`) | M1 | All parse + validate |
| AC-6 | TC-8 | `contract-normalization-responsibilities.mdc` accurately describes the serializer seam; references to "validator does NOT normalize" are removed | Doc review | M1 | Rule text matches current behaviour |
| AC-7 | TC-9 | A rule declares `as Contract` a serializer-bypass smell + the review skills reference it | Doc review | M1 | Rule file + cross-references exist |
| AC-8 | TC-10 | A workspace script greps for `as Contract\b` / `as Contract<` and fails on hits outside the allowlist | Harness | M1 | Script exits non-zero on a planted hit; exit 0 on the cleaned tree |
| AC-9 | TC-11 | One fixture per polymorphic-slot `kind` exists and exercises the snapshot-read seam | Unit | M1 | Tests pass; fixtures named for their kinds |
| AC-10 | TC-12 | CI job invokes the demo's `migration plan` against the checked-in history; fails on non-zero | CI config | M1 | Job exists; runs on PR + main |
| AC-11 | TC-13 | `pnpm typecheck`, `pnpm test:packages`, `pnpm lint:deps`, `pnpm lint:no-contract-cast` (or equivalent) all green | Harness | M1 | All gates pass |

## Milestones

### Milestone 1: route all on-disk contract reads through the serializer seam (`m1`)

The entire spec ships in one milestone. The work is intertwined: stripping `normaliseTypeEntry`'s fallthrough invalidates the demo's checked-in snapshots, so demo regeneration has to land in the same PR. Commits are sequenced for individual greenness; full validation gate runs once at end-of-round.

**Suggested commit sequencing** (implementer can adjust if a different shape reads cleaner):

1. Route bypass sites through `validateContract` (no behavioural change yet — `normaliseTypeEntry` still papers over untagged shapes).
2. Strip `normaliseTypeEntry` fallthrough; add unit tests pinning the strict-throw behaviour.
3. Regenerate demo `start-/end-contract.json` files under the strict deserializer.
4. Add per-kind fixtures + snapshot-read test seam.
5. Rewrite `contract-normalization-responsibilities.mdc`; add `as Contract` smell rule; wire into review skills.
6. Add `lint:no-contract-cast` workspace script + CI job.
7. Add demo-in-CI workflow job.

**Tasks:**

- [ ] **T1.1** Route `readPredecessorEndContract` in `packages/1-framework/3-tooling/cli/src/commands/migration-plan.ts:72-87` through `familyInstance.validateContract`. The function should resolve the right `familyInstance` (the predecessor migration's target family); return type becomes the hydrated `Contract`. (satisfies: TC-1, partial TC-3)
- [ ] **T1.2** Route the second `migration-plan.ts` cast site (`toContractJson = JSON.parse(contractJsonContent) as Contract`, ~line 186) through `familyInstance.validateContract`. The downstream `familyInstance.validateContract(toContractJson)` call becomes redundant — collapse to the single seam. (satisfies: partial TC-3)
- [ ] **T1.3** Route `migration-new.ts:92-102` (`toContractJson = JSON.parse(contractJsonContent) as Contract`) through `familyInstance.validateContract`. (satisfies: partial TC-3)
- [ ] **T1.4** Route `migration-apply.ts:159-178` (`contractRaw = JSON.parse(contractContent) as Contract`) through `familyInstance.validateContract`. (satisfies: partial TC-3)
- [ ] **T1.5** Route `migration-show.ts:281-289` (`appContract = JSON.parse(contractJsonContent) as Contract`) through `familyInstance.validateContract`. (satisfies: partial TC-3)
- [ ] **T1.6** Audit `db-verify.ts:265-280` and any other CLI command that reads on-disk JSON contracts; route through the seam if functionally equivalent. If `db-verify`'s family-internal re-validation is the seam crossing, leave it but add a comment naming the seam-of-record. (satisfies: partial TC-3)
- [ ] **T1.7** Grep `packages/**/src/**` for `JSON.parse(.*\)\s*as\s+Contract` to confirm zero hits remain. Any hit not covered above is in scope; surface unfamiliar sites to the orchestrator before fixing. (satisfies: TC-2)
- [ ] **T1.8** Strip the fallthrough at `packages/2-sql/1-core/contract/src/ir/sql-storage.ts:129` in `normaliseTypeEntry`. After the change, an entry that fails both `isPostgresEnumStorageEntry` and `isStorageTypeInstance` (i.e. an untagged codec triple) throws a `PrismaNextError`-style diagnostic naming the entry's `name` (if present) and its discriminator (or "missing `kind`"). (satisfies: TC-4)
- [ ] **T1.9** Add unit tests for `normaliseTypeEntry`: one fixture for each of (a) tagged `codec-instance`, (b) `postgres-enum`, (c) untagged-triple (asserts throw + diagnostic). (satisfies: TC-4, TC-5)
- [ ] **T1.10** Regenerate `examples/prisma-next-demo/migrations/app/**/start-contract.json` and `end-contract.json` under the strict deserializer. Run `pnpm prisma-next migration plan` against the demo to derive the new shapes; commit the resulting files. (satisfies: TC-6, TC-7)
- [ ] **T1.11** Add a snapshot-validation test that parses every checked-in `*-contract.json` in `examples/**` and `packages/**/test/**/fixtures/**` and round-trips it through `familyInstance.validateContract`. (satisfies: TC-7)
- [ ] **T1.12** Add per-polymorphic-slot-`kind` fixtures under a test package (suggested: a new `packages/2-sql/1-core/contract/test/fixtures/snapshot-read-shapes/` directory). One fixture file per kind shipped in tree: `codec-instance.json`, `postgres-enum.json`, and any pgvector-contributed kinds the implementer enumerates during execution. Each fixture round-trips through the snapshot-read seam under test. (satisfies: TC-11)
- [ ] **T1.13** Rewrite `.cursor/rules/contract-normalization-responsibilities.mdc` to describe current behaviour: the serializer (`familyInstance.validateContract` → `ContractSerializer.deserializeContract` → `hydrateSqlStorage`) is the single normalisation seam for on-disk reads; the builder authors contracts in-memory; the validator both validates structure (arktype) and hydrates into class instances. Remove the "validator does NOT normalize" stance and the example that hand-rolls normalisation outside the serializer. (satisfies: TC-8)
- [ ] **T1.14** Add an `as-contract-cast-smell.mdc` rule (or add to an existing rule — implementer's call) declaring: any `as Contract` / `as Contract<…>` cast in production code is a serializer-bypass smell. Prescribe the `as unknown` + `validateContract<Contract>(...)` replacement (per existing `typed-contract-in-tests.mdc`). Cross-link from `validate-contract-usage.mdc`. (satisfies: TC-9)
- [ ] **T1.15** Reference the new rule from the review skills (`.agents/skills/drive-code-review`, `.agents/skills/drive-pr-local-review`) so reviewers flag the smell during PR review. Pick the natural insertion point in each skill's "what to flag" section. (satisfies: TC-9)
- [ ] **T1.16** Add a workspace script (e.g. `scripts/lint-no-contract-cast.sh` or a Node script under `scripts/`) that greps for `as Contract\b` and `as Contract<` in `packages/**/src/**` and fails on any hit outside the allowlist (`**/*.test.ts`, `**/*.test-d.ts`, the serializer implementation files). Wire into `pnpm lint:no-contract-cast` and into the existing CI lint job (likely under `package.json` scripts + the appropriate GitHub Actions workflow). (satisfies: TC-10)
- [ ] **T1.17** Add a CI job (extend existing `.github/workflows/*.yml`) that runs `pnpm prisma-next migration plan` against `examples/prisma-next-demo` and asserts exit 0 + no resulting diff. If the harness has Postgres infrastructure, also run `migration apply`; if not, plan-only and file a follow-up. (satisfies: TC-12)
- [ ] **T1.18** Run the milestone validation gate (full set, once): `pnpm typecheck && pnpm test:packages && pnpm lint:deps && pnpm lint:no-contract-cast` (or whatever the lint script lands as). (satisfies: TC-13)

**Validation gate:**

- `pnpm typecheck`
- `pnpm test:packages`
- `pnpm lint:deps`
- `pnpm lint:no-contract-cast` (new — name may shift during implementation)
- Demo CI workflow runs locally via `pnpm prisma-next migration plan` against `examples/prisma-next-demo` (exit 0, no diff)
- Cross-package check: grep for `as Contract` in `packages/**/src/**` returns zero hits outside the allowlist

### Close-out (required)

- [ ] Verify all acceptance criteria in `projects/tml-2536-contract-deserializer-seam/spec.md` are met (link to tests / PR diff).
- [ ] Confirm no `formatRevision` / `canonicalVersion` field was added anywhere (regression-on-no-back-compat).
- [ ] Confirm `PostgresEnumStorageEntry` / `PostgresEnumTypeSchema` were not moved or renamed (out of scope; TML-2537's territory).
- [ ] Strip references to `projects/tml-2536-contract-deserializer-seam/**` from `docs/`, READMEs, comments, and other durable artifacts. The rule rewrite is the durable record; the project folder is disposable.
- [ ] Delete `projects/tml-2536-contract-deserializer-seam/`.
- [ ] Do **not** manually transition TML-2536; the PR's branch name carries the identifier and GitHub will auto-complete on merge.

## Open Items

- **Demo `migration apply` in CI.** Whether the demo CI job can run `migration apply` depends on whether a shared Postgres test harness is available to it. If not, scope to `migration plan` only and file a follow-up ticket for `apply` coverage (the planner crash that motivated TML-2536 surfaces at plan time, so plan-only still closes the regression vector).
- **Pgvector and other extension-contributed `kind` values.** AC-9 says "one fixture per polymorphic-slot `kind` shipped in tree." During execution, the implementer enumerates the actual `kind` set under `entityTypeRegistry` (and any target-contributed extensions); the spec list (`codec-instance`, `postgres-enum`) is a minimum.
- **`db-verify.ts` seam shape.** The function path-of-record may use the family's `verify` method, which internally re-validates. If so, T1.6 may be a no-op + a clarifying comment rather than a refactor. Implementer's call.
- **Cross-pollination with TML-2537.** If TML-2537 lands before this PR merges, the `normaliseTypeEntry` strip in T1.8 may need to rebase against a moved `PostgresEnumStorageEntry`. No hard sequencing requirement; rebase cost is small.
- **TML-2515 back-compat policy.** Unanswered. Until it lands, "no back-compat for on-disk shapes" stands as the operating assumption.
