# D3 — PDoD3 grep gate + slice validation + PR open

> **Brief format & scope discipline.** Verification-only + PR assembly. **Zero implementation changes.** If a grep gate or slice validation gate fails, **halt** and route the failure back to D1 (source) or D2 (fixtures) — do not band-aid in D3. The two design-judgment surfaces touched here are (a) the PR-body narrative (operator preference: lead with decisions, end with alternatives; ground in the slot rename + the wider substrate context) and (b) the gate evidence formatting in the PR body (command + zero-hit confirmation).
>
> **Slice spec:** [`projects/contract-ir-planes/slices/enum-migration/spec.md`](../spec.md). **Slice plan:** [`projects/contract-ir-planes/slices/enum-migration/plan.md`](../plan.md) § Dispatch 3. **Linear:** [TML-2623](https://linear.app/prisma-company/issue/TML-2623).

## Why this dispatch exists

D1 (commit `0339f348e`) hard-cut the namespace enum slot in source. D2 (commit `9cebc27dc`) regenerated fixtures + folded JSDoc + reverted the D1 snapshot-test workaround + A4 PASS. D2-R2 (commit `3829f634a`) reconciled the lockfile after D2's emit run leaked a transient test-app importer. All design-judgment work is done; D3 closes the loop with verification gates + PR open.

The orchestrator pre-verified the central gate locally (cache-bypass force `pnpm typecheck` on both slice HEAD and `origin/main` = GREEN; PDoD3 corrected grep = clean; lockfile clean). D3 reproduces the gates in a clean dispatch state for accountability + records evidence into the PR body.

## Settled decisions (don't re-question)

1. **PDoD3 grep gate uses the corrected wording** (slice spec was patched in `5f22452b8` to match project PDoD3 verbatim). The audit pattern is `'postgres-enum'` (literal), **not** `PostgresEnumStorageEntry` (type symbol). The type symbol's continued use in family-sql as a bridging-adapter signature is the legitimate scope of [TML-2667](https://linear.app/prisma-company/issue/TML-2667) follow-up, not S1.B.
2. **Slice validation gates use full `pnpm build` first.** D2-R2 and the D2 reviewer both false-failed `pnpm typecheck` by running it on stale `dist/*.d.mts`. AGENTS.md hygiene: `pnpm install && pnpm build` before any typecheck. Skip per-package filter builds — they don't propagate the cascade through `contract-ts` where D1's IR type narrowing lives.
3. **No tests of opportunity.** Even if you see something that looks fixable, halt and ticket it. D3 is the closing dispatch; scope-creep here breaks the slice's PR reviewability.
4. **PR body lead-with-decisions / end-with-alternatives** (operator preference). The PR opens with the slot rename as the load-bearing decision, narrative-walks D1→D2→R2 + the substrate-cleanup folds, and closes with what was deliberately deferred (TML-2667, TML-2654, TML-2634, TML-2636, TML-2648, S1.C/S1.D scope).
5. **TML-2623 in PR title.** Title format: `TML-2623: <one-line description>`. Example: `TML-2623: hard-cut Postgres enum slot from framework-shared types to namespace-scoped enum`.

## Step-by-step

### Step 1: Clean-state pre-flight

```bash
git status --short                                           # expect empty
git log --oneline origin/main..HEAD                          # expect: cbf889d05, c96183031, 3e78896cb, 0339f348e, 5f22452b8, 366fa20b8, 9cebc27dc, 3829f634a
pnpm install --frozen-lockfile
rm -rf .turbo test/integration/.tsbuildinfo                  # bust turbo cache and tsbuildinfo for clean validation
pnpm build --force
```

If any of these surface unexpected state (untracked files, missing commits, install errors, build errors) — halt and report. **Do not rebuild from a non-clean state.**

### Step 2: PDoD3 grep gate (SDoD6)

```bash
rg "'postgres-enum'" packages/1-framework/ packages/2-sql/9-family/
```

**Expected:** exactly ONE hit, in `packages/1-framework/1-core/framework-components/test/control-stack.test.ts:235` (test-fixture; explicitly allowed by spec SDoD6 carve-out). All other matches indicate a straggler.

### Step 3: Confining grep

```bash
rg "'postgres-enum'" packages/ --glob '!**/node_modules/**' --glob '!**/dist/**'
```

**Expected hits:** `packages/3-targets/3-targets/postgres/**`, `packages/3-targets/6-adapters/postgres/**`, `packages/3-targets/6-adapters/sqlite/**` (per project non-goals — SQLite import for rejection spelling stays), test fixtures, and the framework test-fixture above. Any hit in `packages/1-framework/**/src/`, `packages/2-sql/9-family/**/src/`, or any `packages/2-sql/1-core/contract/src/` source file (validators.ts is allowed — see Soft signal below) — straggler, halt.

### Step 4: Substrate-retirement sanity grep

```bash
rg 'storageSlotKey|reservedStorageSlotKeys|namespaceSlotHydrationRegistry' packages/ --glob '!**/node_modules/**' --glob '!**/dist/**'
```

**Expected:** zero matches. These are S1.A D3-retired surfaces that should never reappear.

### Step 5: SDoD7 confirmation (TML-2658)

```bash
rg "'\\+': 'ignore'" packages/2-sql/9-family/src/core/ir/sql-contract-serializer-base.ts
```

**Expected:** one match on `NamespaceRawSchema`, with the rationale comment present in the surrounding context.

### Step 6: Slice validation gates

```bash
pnpm typecheck                                # full repo, 137/137 expected
pnpm fixtures:check                           # byte-stability gate
pnpm lint:deps                                # layering
pnpm test:packages                            # may surface persistent PG-parallel-infra flakes (see below)
pnpm test:integration                         # ditto
```

Test failures should match the existing PG-parallel-infra flake pattern (Connection terminated / ECONNRESET) — verify each failure individually:

```bash
pnpm --filter <failing-package> test          # if green individually, it's the flake; record in PR body
```

If a failure is NOT the flake pattern (different error / different test) — halt and route back to D1 or D2 as appropriate.

### Step 7: Edge-case disposition audit (SDoD2)

Walk the slice spec § Edge cases table. For each row, confirm disposition is satisfied:

- **#1, #2, #3, #5, #18, document-types guard** → D1 source change handles; verify by reading the test/validator that exercises each
- **#4, #6, #7, #9** → D2 fixture regen handles; verify by spot-checking the regenerated `contract.json` content
- **#10, #11** → D1 validation + D3 grep handles; verify via Step 2/3 results
- **#12 (replay falsifies)** → D2 A4 PASS handles; verify via D2 commit body
- **#13 (A6 falsified)** → not triggered; A6 confirmed by operator pre-slice
- **#8, #14-#17, SQLite import, TML-2654** → Out / Defer per spec § Out of scope; no action

### Step 8: Open the PR

Body assembly outline (operator preference: lead-with-decisions, end-with-alternatives):

1. **Headline** — one-paragraph statement of the slot rename + why it matters (substrate works; one pack-contributed entity kind owns its slot)
2. **At a glance** — before/after diff of the on-disk contract shape (`storage.namespaces.<ns>.types.<enum>` → `storage.namespaces.<ns>.enum.<enum>`)
3. **Narrative walk** D1 → D2 → R2:
   - D1: source hard-cut + TML-2658 fold; 24-file diff; descriptor mechanism from S1.A drives composition
   - D2: fixture regen across 4 contracts + paired `.d.ts`; A4 PASS (bookends unchanged; replay regression identical pre/post); 2-line JSDoc fold-in; `snapshot-read-shapes.test.ts` workaround reverted
   - R2: lockfile reconciliation (133-line cruft removed)
4. **PDoD3 gate evidence** — paste the three grep commands from Steps 2/3/4 with their zero-or-allowed output
5. **What this slice does NOT do (deferred follow-ups)** — TML-2667 (descriptor-driven verifier), TML-2654 (emit-pipeline plain-literal namespace fix), TML-2634 (plural slot rename), TML-2636 (namespace shape refactor), TML-2648 (SQLite mongo-builder lift), S1.C (domain-plane population), S1.D (project-level cleanup). Pre-existing 2 framework JSDoc hits flagged as project-scope carry-over per D1 reviewer note.
6. **Test plan** — TODO checkboxes for reviewer-side validation: PDoD3 grep, fixture inventory matches, `pnpm typecheck` after full build (note the AGENTS.md hygiene rule), A4 disposition acceptable
7. **References** — slice spec, slice plan, ADR Decision 5, project PDoD3, retro entries (2026-05-22 SDoD6 over-strictness; the QA-run stale-dist hygiene to extend if it bites again here)

Open with `gh pr create`:

```bash
gh pr create --base main --head tml-2623-s1b-enum-migration \
  --title "TML-2623: hard-cut Postgres enum slot from framework-shared types to namespace-scoped enum" \
  --body "$(cat /tmp/pr-body.md)"
```

(Stage the body in `/tmp/pr-body.md` or via a heredoc to preserve formatting.)

## Done when

- [ ] **Step 1** clean-state pre-flight succeeds; no unexpected state surfaced
- [ ] **Step 2** PDoD3 grep returns ONE hit (the test-fixture allowed by SDoD6 carve-out)
- [ ] **Step 3** confining grep returns hits only in allowed paths (Postgres target/adapter, SQLite adapter, test fixtures, framework test fixture)
- [ ] **Step 4** substrate-retirement sanity grep returns zero hits
- [ ] **Step 5** TML-2658 directive present with rationale comment
- [ ] **Step 6** slice validation gates green; any test failures are confirmed pre-existing PG flakes (with per-package verification)
- [ ] **Step 7** edge-case audit complete; every spec edge row has disposition confirmed
- [ ] **Step 8** PR opened; URL captured in wrap-up
- [ ] **PR body** includes grep evidence (command + output), narrative walk, deferred-follow-up list, test plan
- [ ] **PR title** uses `TML-2623:` prefix
- [ ] **No source changes** introduced in D3

## Brief overlay (drive-build-workflow execution discipline)

- **F5 forbidden:** no destructive git operations.
- **No tests of opportunity.** Even if you spot a clean improvement, halt and surface — D3 closes the slice; scope-creep breaks reviewability.
- **No new ticket filing** without operator confirmation — the deferred-follow-up list already covers everything we know about.
- **Lead with decisions in PR body.** Don't dump 200 lines of "and then I did X". Decisions first, narrative second, evidence third, alternatives last.
- **Use the corrected PDoD3 wording** in the grep evidence — the verbatim project-PDoD3 pattern, not the original over-strict SDoD6.

## Refusal triggers (halt — do not work around)

- **PDoD3 grep returns >1 hit** (the one allowed test-fixture) — straggler. Halt. Route the file back to D1 follow-up.
- **Substrate-retirement sanity grep finds `storageSlotKey` / `reservedStorageSlotKeys` / `namespaceSlotHydrationRegistry`** — S1.A regression. Halt, surface immediately.
- **`pnpm typecheck` fails after Step 1's clean-state build** — real failure (not stale-dist). Halt. Route to D1 (source cascade) or D2 (fixture/`.d.ts` mismatch). Do NOT band-aid in D3.
- **`pnpm fixtures:check` fails after Step 1's clean-state build** — fixture drift. Halt. Route to D2.
- **`pnpm lint:deps` fails** — layering violation. Halt and surface (this would be a serious regression — D1's diff went through lint:deps clean at dispatch time).
- **Test failure that's NOT the existing PG-parallel-infra flake pattern** — halt; route to originating dispatch.
- **Source change is proposed** — even one line — halt. D3 is verification-only.

## Model tier

**Composer-2.5 (`composer-2.5-fast`).** Per [`drive/calibration/model-tier.md`](../../../../drive/calibration/model-tier.md): pure verification + scripted PR body. No design judgment. **Escalate to Opus 4.7** only if Step 6 surfaces a test failure that needs cross-file diagnostic work (in which case the right move is halt-and-route anyway).

## Soft signals (orchestrator notes for the implementer)

- **`packages/2-sql/1-core/contract/src/validators.ts:89/106/240` carries `'postgres-enum'` string literals.** These pass the PDoD3 grep gate (they're in `1-core/contract/`, not `1-framework/` or `9-family/`) and are legitimate — they're descriptor-key strings in the validator-composition machinery. The D2 reviewer's Soft signal #2 also called this out. Don't try to remove them.
- **D2 reviewer's "pre-existing typecheck failure" claim was false.** Orchestrator verified `pnpm typecheck` is GREEN on both slice HEAD and `origin/main` after full force builds. No follow-up ticket needed for that. If you observe the same failure: re-run `pnpm install --frozen-lockfile && rm -rf .turbo test/integration/.tsbuildinfo && pnpm build --force && pnpm typecheck`.
- **CI is the authoritative gate for `test:packages` / `test:integration`.** Local runs of these surface PG-parallel-infra flakes. If you see Connection-terminated / ECONNRESET failures in those test suites, per-package re-runs confirm pre-existing flake.

## Report back

Wrap-up message must include:

1. **PR URL** and final HEAD SHA + push confirmation
2. **Step 1-7 gate results** with command output digest
3. **Step 8 PR body link** to the rendered body (paste excerpt if convenient)
4. **Any halt triggered** — if zero, say so explicitly
5. **Test:packages / test:integration failure inventory** if any surfaced — confirm each is the flake pattern (per-package re-run = green)
6. **Edge-case audit table** — one row per spec edge with disposition + evidence pointer

## References

- Slice spec: [`../spec.md`](../spec.md) (corrected SDoD6, edge cases, SDoD1-8)
- Slice plan: [`../plan.md`](../plan.md) § Dispatch 3
- D1 brief: [`./01-source-migration.md`](./01-source-migration.md) | D1 commit `0339f348e`
- D2 brief: [`./02-fixture-regen.md`](./02-fixture-regen.md) | D2 commit `9cebc27dc` | D2-R2 commit `3829f634a`
- Project spec PDoD3 (gate source of truth): [`../../../spec.md`](../../../spec.md) § PDoD3 (line ~242)
- ADR Decision 5 (slot-key essence + singular): [`../../../adrs/0001-contract-planes.md`](../../../adrs/0001-contract-planes.md)
- Calibration: [`drive/calibration/failure-modes.md`](../../../../drive/calibration/failure-modes.md), [`grep-library.md`](../../../../drive/calibration/grep-library.md)
- Retro entries (relevant): `drive/retro/findings.md` (2026-05-21 QA-run stale-dist hygiene; 2026-05-22 SDoD6 over-strictness)
- Deferred follow-up tickets: TML-2667, TML-2654, TML-2634, TML-2636, TML-2648
