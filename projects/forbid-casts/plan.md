# Forbid casts — project plan

> **Single-slice project.** The design discussion's depth justified the project home; the implementation fits one PR. Per the "design depth ≠ slice count" heuristic in [`drive/triage/README.md`](../../drive/triage/README.md).

**Spec:** [`./spec.md`](./spec.md)
**Design notes:** [`./design-notes.md`](./design-notes.md)

## Summary

One slice landing the helpers (`blindCast`, `castAs`), the biome custom rule, the CI ratchet, the agent rule + skill, and the `AGENTS.md` update — all in one PR. No mass sweep; the ratchet drives the count down over time via "convert when you touch" agent guidance.

## Slices

### Slice: forbid-casts (single slice, one PR)

**Purpose.** Land the cast helpers, the biome custom rule, the CI ratchet against `git merge-base origin/main HEAD`, the agent rule + skill, and the `AGENTS.md` update — in one PR.

**Target Linear issue:** [TML-2685](https://linear.app/prisma-company/issue/TML-2685/forbid-casts).

**Scope (one PR):**

1. **`packages/0-shared/cast-utils/`** — new package exporting:
   - `blindCast<T, Reason extends string>(input: unknown): T` (per [`./reference/blindCast.ts`](./reference/blindCast.ts))
   - `castAs<T>(value: T): T` (per [`./reference/castAs.ts`](./reference/castAs.ts))
   - Package boilerplate, `package.json` workspace registration, `tsdown` config, tsconfig.

2. **Biome custom rule** — fires on every `as` token in production code except:
   - `as const` (pass-through).
   - The single line `return input as TargetType` inside `blindCast`'s body (covered by an in-file `// biome-ignore lint/casts/no-bare-cast: this is the helper itself` magic comment).

   *Verification step before committing:* a small prototype that confirms biome's plugin DSL can express the recognition surface (A2). If it can't, fall back to a ts-morph standalone script.

3. **Biome test-file override** — extend the existing `overrides` block in `biome.jsonc` (the one already disabling `noNonNullAssertion` for tests) to turn the cast rule off for `**/*.test.ts`, `**/*.test-d.ts`, `**/test/**/*.ts`.

4. **CI ratchet script** — wrapper that:
   - Runs biome with `--only=<rule-id> --reporter=json` on HEAD.
   - Uses `git worktree add --detach $(git merge-base origin/main HEAD)` to materialize the merge-base.
   - Runs the same biome invocation on the merge-base worktree.
   - Counts violations on each, fails if HEAD's count exceeds merge-base.
   - Skips when running on `main` itself.
   - Emits per-site diagnostics in the failure message (file:line + helper suggestion).
   - Lands as a `pnpm` script (e.g. `pnpm lint:casts`) plus a CI step in the existing lint workflow.

5. **`.cursor/rules/no-bare-casts.mdc`** — Cursor rule documenting the contract:
   - Forbid bare `as`.
   - Reach for `blindCast`/`castAs`/`satisfies`/type-tightening instead.
   - "Convert when you touch" expectation: any time you touch a cast site, convert it.

6. **`skills-contrib/no-bare-casts/SKILL.md`** — agent skill that fires when:
   - An agent is about to write `as` in production code.
   - An agent touches an existing cast site as part of unrelated work.
   The skill educates on the alternatives (`blindCast` / `castAs` / type-tightening) and surfaces the "convert when you touch" rule.

7. **`AGENTS.md § Typesafety rules`** — update to reference the helpers, the lint rule, and the skill.

8. **At least one production call-site conversion** — find one existing `as` cast (non-test code), convert it to `blindCast` or `castAs`. Provides AC1 evidence and verifies the ratchet's "count decreased" path.

9. **Tests:**
   - Unit tests for the helpers (type assertions; runtime no-op behaviour).
   - Fixture test for the biome rule (a fixture file with one violation; verify rule fires; a fixture with `as const`; verify rule does NOT fire).
   - Smoke test for the ratchet script (simulated branch with +1 / -1 / 0 deltas).

**Out of scope for this slice:**

- Converting more than the one demonstration call site.
- Landing `assertPresent` / `assertExhausted` / `dontAwait`.
- Promoting `satisfies` over `as` for type-checked cases via a separate rule.

**Done when:**

- All AC items in [`./spec.md § Acceptance criteria`](./spec.md#acceptance-criteria) pass.
- `pnpm build` / `pnpm typecheck` / `pnpm test` / `pnpm lint:deps` clean.
- The ratchet's three scenarios (+1 cast → fail, -1 cast → pass + count drops, 0 delta → pass) verified end-to-end.
- The biome plugin prototype (A2 verification) committed under this slice's diff history.

## Dispatch plan

Four dispatches, sequential. Each is M-sized or smaller; no L/XL per the M-cap. Dispatches build on each other: D1 is the foundation (helpers); D2 adds the rule that recognises violations; D3 wraps the rule in a CI ratchet; D4 lands the agent surfaces and `AGENTS.md` update.

### Dispatch 1: `cast-utils` package + helpers + unit tests + AC1 conversion

**Intent.** Create the `@prisma-next/cast-utils` package under `packages/0-shared/`, exporting `blindCast<T, Reason extends string>(input: unknown): T` and `castAs<T>(value: T): T`. Add unit tests for both helpers. Convert one existing bare `as` cast in production code to demonstrate end-to-end usage (provides AC1 evidence).

**Files in play.**

- `packages/0-shared/cast-utils/package.json` (new — model on `packages/0-shared/extension-author-tools/package.json`)
- `packages/0-shared/cast-utils/src/blindCast.ts` (new — implementation per [`../reference/blindCast.ts`](./reference/blindCast.ts))
- `packages/0-shared/cast-utils/src/castAs.ts` (new — implementation per [`../reference/castAs.ts`](./reference/castAs.ts))
- `packages/0-shared/cast-utils/src/index.ts` (new — re-export both helpers)
- `packages/0-shared/cast-utils/test/blindCast.test.ts` (new — unit tests)
- `packages/0-shared/cast-utils/test/castAs.test.ts` (new — unit tests)
- `packages/0-shared/cast-utils/tsconfig.json` (new — copy sibling shape)
- `packages/0-shared/cast-utils/README.md` (new — brief)
- One existing TS file containing a bare `as` cast — implementer identifies a low-risk site (e.g. small utility, well-covered by tests); converts to `blindCast` or `castAs`. Demonstrates AC1.

**"Done when":**

- [ ] `pnpm install` succeeds; new package registered in workspace.
- [ ] `pnpm build` clean.
- [ ] `pnpm typecheck` clean.
- [ ] `pnpm test:packages -- @prisma-next/cast-utils` passes (helpers' unit tests).
- [ ] `pnpm lint:deps` clean (cast-utils is universal-import; no layering violation).
- [ ] The converted call site compiles and the package's existing tests still pass.
- [ ] Intent-validation: diff is the new package + exactly one consumer-side conversion. No other surfaces touched.

**Size.** M.

**DoR confirmed:** [✓]

### Dispatch 2: Biome custom rule + helper self-exemption + test-file override + rule fixture test

**Intent.** Add a biome custom plugin (per biome v2's plugin DSL — verify expressiveness first per A2) that fires on every `as` token in production code, except `as const` and the single line in `blindCast.ts` whitelisted by an in-file `// biome-ignore` comment. Extend `biome.jsonc`'s existing test-file `overrides` block to disable the rule for tests. Add fixture tests for the rule (positive case fires; `as const` doesn't; whitelisted line doesn't; test file doesn't).

**A2 verification step (first sub-task).** Before committing to the biome plugin path, write a small GritQL (or whichever DSL biome 2.4.14 ships) prototype that confirms the recognition surface is expressible. If it isn't, **halt the dispatch and route to `drive-discussion`** per stop-condition #2 (unpinned design decision: fallback to ts-morph standalone script needs operator authorisation).

**Files in play.**

- Biome plugin source — location depends on biome's plugin layout convention (likely `biome-plugins/no-bare-cast.grit` at repo root, or under a tooling package; implementer picks during the verification step).
- `biome.jsonc` (root) — register the plugin under `plugins`; add the rule to the existing test-file `overrides` block with `"off"`.
- `packages/0-shared/cast-utils/src/blindCast.ts` — add `// biome-ignore lint/casts/no-bare-cast: this is the helper itself` on the line `return input as TargetType`.
- Plugin test fixtures — at least: (a) a file with bare `as Foo` (must fire); (b) a file with `as const` (must NOT fire); (c) verification that `blindCast.ts`'s body line does NOT fire (self-exemption honoured); (d) a `.test.ts` file with `as Foo` (must NOT fire — test override honoured).

**"Done when":**

- [ ] A2 verification prototype committed and confirms biome plugin expressiveness (or, on falsification, dispatch halted via stop-condition).
- [ ] Plugin file checked in; biome.jsonc registers it.
- [ ] Running `pnpm biome check` on the fixture with bare `as` reports the violation under the rule's ID.
- [ ] Running `pnpm biome check` on the `as const` fixture does not report.
- [ ] Running `pnpm biome check` on `packages/0-shared/cast-utils/src/blindCast.ts` does not report (the in-file `// biome-ignore` is honoured).
- [ ] Running `pnpm biome check` on a `.test.ts` fixture with bare `as` does not report.
- [ ] Existing `pnpm lint:packages` / `pnpm lint:code` / `pnpm typecheck` / `pnpm test:packages` clean (the rule is loaded but no production-file violation count rose this dispatch — D3 wires the ratchet).
- [ ] Intent-validation: diff is biome plugin + biome.jsonc + the one `// biome-ignore` line + fixtures. No other surfaces touched.

**Size.** M (with A2 risk — could expand if biome plugin DSL falls short; the verification step is the early-exit).

**DoR confirmed:** [✓]

### Dispatch 3: CI ratchet script + `pnpm lint:casts` + CI workflow integration + smoke test

**Intent.** Add a wrapper script that runs biome with `--only=<rule-id> --reporter=json` on HEAD and on `git merge-base origin/main HEAD` (via `git worktree add --detach`), counts the violation lists, fails if HEAD's count exceeds merge-base. Register as `pnpm lint:casts`. Wire into `.github/workflows/ci.yml`'s existing Lint job. Add a smoke test that simulates the three scenarios (+1 / −1 / 0 delta) end-to-end.

**Files in play.**

- `scripts/lint-casts.mjs` (new — Node script preferred for portability; bash acceptable if simpler).
- `package.json` (root) — register `"lint:casts": "node ./scripts/lint-casts.mjs"`.
- `.github/workflows/ci.yml` — add `- name: Lint casts\n  run: pnpm lint:casts` step inside the `lint` job, alongside the existing `lint:*` steps. Ensure `fetch-depth: 0` (or sufficient depth) is set on the checkout step so `git merge-base origin/main HEAD` resolves (the CI job already needs git history for `check:upgrade-coverage`; verify the depth is shared).
- `scripts/test/lint-casts.test.mjs` (new — smoke test exercising +1 / −1 / 0 delta scenarios via temporary git fixtures).

**"Done when":**

- [ ] `pnpm lint:casts` runs locally and prints a structured `current=N merge-base=M delta=N-M` line.
- [ ] When run on a branch that adds a bare `as` to production code, exits non-zero and lists the new site(s) with file:line + suggested helper.
- [ ] When run on a branch that removes a bare `as`, exits zero and reports a negative delta.
- [ ] When run on a branch with net-zero changes to cast count, exits zero.
- [ ] When run on `main` itself (no merge-base diff), skips with a clear message and exits zero.
- [ ] Uses `git worktree add --detach <merge-base>` to materialize merge-base; cleans up the worktree on exit (incl. on failure).
- [ ] `pnpm test:scripts` (CI's existing scripts test) covers the smoke test cases.
- [ ] CI workflow integrates the step under the existing Lint job; YAML lints clean per `pnpm lint:workflows`.
- [ ] Intent-validation: diff is `scripts/lint-casts.mjs` + `scripts/test/lint-casts.test.mjs` + `package.json` + `.github/workflows/ci.yml`. No other surfaces touched.

**Size.** M.

**DoR confirmed:** [✓]

### Dispatch 4: Agent surfaces (Cursor rule + skill) + `AGENTS.md` update

**Intent.** Land the agent prevention and education surfaces — `.cursor/rules/no-bare-casts.mdc` (canonical home: `.agents/rules/no-bare-casts.mdc`; `.cursor/` is a symlink per `AGENTS.md`), `skills-contrib/no-bare-casts/SKILL.md` (canonical home for the skill; `prepare` hook materializes mirrors), and update `AGENTS.md § Typesafety rules` to name the helpers, the lint rule, and link to the skill.

**Files in play.**

- `.agents/rules/no-bare-casts.mdc` (new) — Cursor rule body. Contract: forbid bare `as`, reach for `blindCast`/`castAs`/`satisfies`/type-tightening, "convert when you touch" expectation.
- `skills-contrib/no-bare-casts/SKILL.md` (new) — agent skill that fires on triggers ("about to write `as`", "touching an existing cast site"); educates on the alternatives at the moment of action.
- `AGENTS.md` § Typesafety rules — append references to `blindCast`, `castAs`, the lint rule's ID, and the skill name.
- (Auto-generated) `.claude/skills/no-bare-casts/SKILL.md` and `.agents/skills/no-bare-casts/SKILL.md` — produced by the `prepare` hook after `pnpm install`.

**"Done when":**

- [ ] `pnpm install` re-materializes the skill under `.agents/skills/no-bare-casts/` and `.claude/skills/no-bare-casts/`; MD5 checksums match the canonical `skills-contrib/no-bare-casts/SKILL.md`.
- [ ] `.cursor/rules/no-bare-casts.mdc` is discoverable via the symlink chain.
- [ ] `pnpm lint:rules` clean (rules linter accepts the new rule).
- [ ] `pnpm lint:rules:footprint` clean.
- [ ] `pnpm lint:docs` clean (`AGENTS.md` references resolve).
- [ ] `AGENTS.md § Typesafety rules` lists `blindCast`, `castAs`, the rule, and the skill.
- [ ] Intent-validation: diff is `.agents/rules/no-bare-casts.mdc` + `skills-contrib/no-bare-casts/SKILL.md` + `AGENTS.md` + autogenerated mirrors. No other surfaces touched.

**Size.** S/M (text-heavy but bounded; no judgment-heavy decisions).

**DoR confirmed:** [✓]

### Dispatch sequencing notes

- D1 → D2: D2 references `blindCast.ts` (added in D1) by path for the self-exemption.
- D2 → D3: D3 calls `biome check --only=<rule-id>` (added in D2). The rule must exist before the ratchet wraps it.
- D3 → D4: D4 is independent of D3 mechanically; sequenced last because agent education should reference the now-live rule's ID.
- All four can be commits on the same branch (`tml-2685-forbid-casts`); the final PR contains all four dispatches' diffs.

## Promote signal

If implementation reveals the single PR is not reviewable in one sitting (~30 min), that's a mid-flight promote signal. Likely triggers:

- The biome plugin DSL turns out to need substantial bespoke logic (A2 falsifies); the ts-morph fallback grows beyond a few hundred lines.
- The ratchet script needs more orchestration than expected (worktree-management edge cases, CI integration surprises).

In either case, halt and route via `drive-start-workflow` for re-triage.

## Close-out (required)

- Verify all acceptance criteria in [`./spec.md`](./spec.md).
- Migrate long-lived docs into `docs/`: specifically the `cast-utils` API reference (if not adequately covered by `AGENTS.md` and the Cursor rule).
- Strip repo-wide references to `projects/forbid-casts/**` (replace with canonical `docs/` links or remove). The reference utilities under `projects/forbid-casts/reference/` are inputs to this project; they live on as the production code in `packages/0-shared/cast-utils/` after this slice lands.
- Delete `projects/forbid-casts/`.
- Final retro per `drive-run-retro` (mandatory project-close retro per invariant I10).
