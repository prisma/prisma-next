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

2. **Biome custom rule** — fires on every `as` token in production code except `as const` (pass-through). No `blindCast.ts`-body self-exemption is needed: `blindCast`'s body is reshaped to avoid the `as` keyword (going through a hyper-local `any` instead), so the rule has no token in the helper to fire on. The `any` is suppressed with a built-in `// biome-ignore lint/suspicious/noExplicitAny: <reason>` comment — see [`./design-notes.md § Accepted trade-offs`](./design-notes.md#accepted-trade-offs).

   *Verification step before committing:* a small prototype that confirms biome's plugin DSL can express the recognition surface (A2). **Outcome (recorded in spec § Assumptions):** A2 confirmed for recognition + `as const` carve-out; biome's GritQL plugin diagnostics do not support `// biome-ignore` suppression (resolved by the `any`-relocation tactic above) or `--only=<rule-id>` filtering (resolved in D3 via `--reporter=json` + filter).

3. **Test-file exclusion** — implemented inside the GritQL plugin source as a `file()` predicate matching `**/*.test.ts`, `**/*.test-d.ts`, `**/test/**/*.ts`. Biome 2.4.x's `overrides` mechanism cannot clear GritQL plugins inherited from the top-level config (verified during D2); the exclusion lives in the plugin source instead. Patterns mirror biome's existing test-file `overrides § includes` so the two lists stay legible side-by-side. See [`./design-notes.md § Accepted trade-offs`](./design-notes.md#accepted-trade-offs).

4. **CI ratchet script** — wrapper that:
   - Runs biome with `--reporter=json` on HEAD and filters the diagnostic list by `category == "plugin"` *and* the `no-bare-cast` plugin's distinctive message prefix (rationale: biome's `--only` flag does not work for GritQL plugin diagnostics; see [`./design-notes.md § Accepted trade-offs`](./design-notes.md#accepted-trade-offs)).
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

**Intent.** Add a biome GritQL plugin that fires on every `as` token in production code, except `as const`. Extend `biome.jsonc`'s existing test-file `overrides` block to disable the rule for tests. Reshape `blindCast`'s body to avoid the `as` keyword (so the rule has nothing to fire on inside the helper, and no plugin-suppression is needed — see [`../design-notes.md § Accepted trade-offs`](./design-notes.md#accepted-trade-offs)). Add fixture tests for the rule (positive case fires; `as const` doesn't; `blindCast.ts` doesn't; test file doesn't).

**A2 verification: completed.** The verification prototype was committed in D2 R1 as `d8cb7f90a` and confirmed (a) recognition + `as const` carve-out work; (b) biome's GritQL plugin diagnostics do not support `// biome-ignore` suppression or `--only=<rule-id>` filtering. Resolutions are recorded in [`./design-notes.md § Accepted trade-offs`](./design-notes.md#accepted-trade-offs); this dispatch now lands the production rule with those resolutions baked in.

**Files in play.**

- Biome plugin source (production rule) — location: `biome-plugins/no-bare-cast.grit` (or equivalent path; implementer picks the final convention). The plugin source carries both (i) the `as const` carve-out via the regex condition on `$t`, and (ii) the test-file exclusion via a `file()` predicate matching `**/*.test.ts`, `**/*.test-d.ts`, `**/test/**/*.ts`.
- `biome.jsonc` (root) — register the plugin under `plugins`. (No new `overrides` block entry is needed for test-file exclusion: that's handled inside the plugin per the design pivot.)
- `packages/0-shared/cast-utils/src/blindCast.ts` — reshape body from `return input as TargetType` to `const x: any = input; return x;` (or semantically equivalent); add a `// biome-ignore lint/suspicious/noExplicitAny: <Reason articulating why this helper is the canonical home for the type-system escape>` on the `: any` line. Update the TSDoc if necessary to keep the last-resort framing internally consistent.
- Plugin test fixtures — at least: (a) a file with bare `as Foo` and `as unknown as Foo` (must fire); (b) a file with `as const` (must NOT fire); (c) verification that `blindCast.ts` produces zero new-rule diagnostics (because no `as` token exists in the body any more); (d) a `.test.ts` file with `as Foo` (must NOT fire — `file()` predicate honoured); (e) a file under a nested `test/` directory like `test/sub/foo.ts` (must NOT fire — verifies the regex matches the same depth as biome's `**/test/**/*.ts` glob).

**"Done when":**

- [x] A2 verification prototype committed (`d8cb7f90a`); biome plugin expressiveness confirmed for recognition; gaps for suppression + `--only` resolved per design-notes.
- [ ] Production plugin file checked in (replaces or renames `biome-plugins/test-no-bare-cast.grit`); `biome.jsonc` registers it.
- [ ] `blindCast.ts` body reshaped to use `any` (no `as` token in the body); built-in `noExplicitAny` suppression carries a `Reason`-style justification.
- [ ] Running `pnpm biome check` (or `pnpm biome lint`) on the bare-`as` fixture reports the violation.
- [ ] Running it on the `as const` fixture does not report.
- [ ] Running it on `packages/0-shared/cast-utils/src/blindCast.ts` produces no new-rule diagnostics, and the built-in `noExplicitAny` is suppressed at the one `: any` line.
- [ ] Running it on a `.test.ts` fixture with bare `as` does not report (test override honoured).
- [ ] Existing `pnpm lint:packages` / `pnpm lint:code` / `pnpm typecheck` / `pnpm test:packages` clean (the rule is loaded but no production-file violation count rose this dispatch — D3 wires the ratchet).
- [ ] Intent-validation: diff is biome plugin + biome.jsonc + the one-line `blindCast.ts` body reshape + the suppression comment + fixtures. No other surfaces touched.

**Size.** M.

**DoR confirmed:** [✓]

### Dispatch 3: CI ratchet script + `pnpm lint:casts` + CI workflow integration + smoke test

**Intent.** Add a wrapper script that runs biome with `--reporter=json` on HEAD and on `git merge-base origin/main HEAD` (via `git worktree add --detach`), filters the JSON diagnostic list to entries from the `no-bare-cast` plugin (by `category == "plugin"` *and* the plugin's distinctive message-text prefix — biome's `--only` flag does not work for GritQL plugin diagnostics; see [`./design-notes.md § Accepted trade-offs`](./design-notes.md#accepted-trade-offs)), counts each side, fails if HEAD's count exceeds merge-base. Register as `pnpm lint:casts`. Wire into `.github/workflows/ci.yml`'s existing Lint job. Add a smoke test that simulates the three scenarios (+1 / −1 / 0 delta) end-to-end.

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
