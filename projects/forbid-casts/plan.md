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
