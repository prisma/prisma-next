# Forbid casts — project spec

## Summary

Forbid bare `as` casts in prisma-next via a biome custom lint rule, plus a compare-to-merge-base CI ratchet that prevents the cast count from increasing in any PR. Authors must use one of two new helpers — `blindCast<T, Reason extends string>` (unsafe; requires an articulated reason at the call site) or `castAs<T>` (type-checked pass-through) — or eliminate the cast by tightening types. Agent rules and a skill educate agents to convert casts incidentally when they touch surrounding code, driving the count down over time without a mass sweep.

## Description

### Problem

`AGENTS.md` already says "Minimize type casts" and requires comments on `as unknown as`. But the rule is enforced only by code review. Agents working in this repo routinely insert casts to silence type errors without articulating the guarantee they're giving up, and reviewers don't catch every one. There are ~3,400 `as` usages across `packages/` today; the operator wants the number to stop growing and to decrease over time.

### Approach (settled)

**Maximalist recognition.** A biome custom rule fires on every `as` token in production code. The only carve-out at the `as`-token level is `as const` (a syntactic operator producing a `readonly` literal type — not a type assertion). Everything else routes through one of two helpers or is eliminated by tightening types. `satisfies` and `asserts value is T` are different keywords and unaffected.

**Two helpers.**

- `blindCast<T, Reason extends string>(input: unknown): T` — for the case where the input type is genuinely opaque or unrelated to the target. Forces the author to articulate the compromise via the `Reason` literal at the call site. Reference implementation: [`./reference/blindCast.ts`](./reference/blindCast.ts).
- `castAs<T>(value: T): T` — runtime pass-through that displaces type-checked-but-explicit `as` casts (where the LHS already satisfies the type). Reference implementation: [`./reference/castAs.ts`](./reference/castAs.ts).

Both helpers live in a new `packages/0-shared/cast-utils/` package (name TBD per OQ2), importable by every workspace package.

**Compare-to-merge-base ratchet.** CI counts cast-rule violations at HEAD and at `git merge-base origin/main HEAD`; fails if HEAD's count is higher. The count ratchets down naturally whenever a PR removes a cast. No baseline file is committed.

**Agent guidance.** `.cursor/rules/no-bare-casts.mdc` plus a `skills-contrib/no-bare-casts/SKILL.md` skill educate agents on the alternatives and the "convert when you touch" expectation. `AGENTS.md` is updated to point at both.

**No mass sweep.** Existing cast sites are converted incidentally as code is touched. The ratchet prevents regression; the agent guidance drives reduction.

**Test code is excluded.** Biome's existing test-file `overrides` block (`**/*.test.ts`, `**/*.test-d.ts`, `**/test/**/*.ts`) turns the cast rule off. Tests routinely use casts for stubbing and negative type assertions; enforcing the rule there imposes friction with no review benefit.

### Users

- **Implementer agents** in this repo (the primary audience).
- **Human contributors** — symmetric treatment.
- **Reviewers** — beneficiaries; reviewing a `blindCast<T, "reason">(...)` or `castAs<T>(value)` is faster than reviewing a bare `as`.

## Requirements

### Functional requirements

- **FR1** — `blindCast<T, Reason extends string>(input: unknown): T` is exported from `packages/0-shared/cast-utils/` and importable by every workspace package. The helper's TSDoc comment frames it as a **last resort, not a sanctioned tool to reach for**: it names rewriting the code so the cast becomes unnecessary as the first option, and tells the reader that the reviewer will validate whether the `Reason` justification holds up under scrutiny — an unconvincing justification is an instruction to go solve the underlying type-system problem instead.
- **FR2** — `castAs<T>(value: T): T` is exported from the same package.
- **FR3** — A biome custom rule reports every `as` token in production code except `as const`. (No `blindCast.ts` body-line exemption is required: per the implementation tactic in [`./design-notes.md`](./design-notes.md), `blindCast`'s body avoids the `as` keyword entirely, so there is no token in the helper for the rule to fire on.)
- **FR4** — The rule does not fire on test files matching `**/*.test.ts`, `**/*.test-d.ts`, `**/test/**/*.ts`. (Implementation tactic: the exclusion lives inside the GritQL plugin source as a `file()` predicate, mirroring the patterns biome's existing `overrides` block already uses for other test-file rule disables. Rationale: biome 2.4.x's `overrides` mechanism cannot clear plugins inherited from the top-level config — the same gap-family as A2/A3. Recorded in [`./design-notes.md § Accepted trade-offs`](./design-notes.md#accepted-trade-offs).)
- **FR5** — A CI ratchet script runs the rule on HEAD and on `git merge-base origin/main HEAD`, fails the CI step if HEAD's violation count exceeds the merge-base count. Skipped on `main` itself.
- **FR6** — The ratchet's failure message lists per-site `file:line` locations for the *added* casts and suggests `blindCast`/`castAs` as alternatives.
- **FR7** — A `.cursor/rules/no-bare-casts.mdc` rule documents the contract for agents in the Cursor surface. The rule explicitly frames `blindCast` as a last resort (not a sanctioned tool), names rewriting the code so the cast becomes unnecessary as the first option, and tells agents the reviewer will validate the `Reason` and push back if it doesn't hold water.
- **FR8** — A `skills-contrib/no-bare-casts/SKILL.md` skill fires on agent triggers (writing `as`, touching a cast site) to educate about the alternatives. The skill restates the rewrite-first / blindCast-as-last-resort / reviewer-validates-justification framing in agent-actionable form. The skill materializes to `.claude/skills/` and `.agents/skills/` via the existing `prepare` hook.
- **FR9** — `AGENTS.md § Typesafety rules` is updated to point at the helpers, the lint rule, and the skill.

### Non-functional requirements

- **NFR1** — The lint rule and the ratchet integrate with the existing CI lint step; no new green-field CI surface.
- **NFR2** — The ratchet runs well within the existing lint step's wall-clock budget. (Biome scans on a 3,400-site repo are sub-second; the ratchet runs biome twice.)
- **NFR3** — The ratchet does not mutate the developer's working tree — it uses `git worktree add --detach <merge-base>` to materialize the merge-base, not `git checkout` / `git stash`.
- **NFR4** — The helpers, rule, and ratchet cause no `pnpm build` / `pnpm typecheck` / `pnpm test` / `pnpm lint:deps` regressions.

### Non-goals

- Mass-rewriting the ~3,400 existing cast sites in this project. (Incidental rewrites via the agent rules; no large sweep.)
- Landing `assertPresent` / `assertExhausted` / `dontAwait` / other adjacent helpers. (Out of scope; possibly future work.)
- Promoting `satisfies` over `as Foo` via a separate rule. (Out of scope; the current rule routes both through the helpers.)
- Changing what casts mean at runtime. (`blindCast` is compile-time-only; its body is the single `as` whitelisted in-file.)

## Acceptance criteria

- **AC1** — `packages/0-shared/cast-utils/` (final name per OQ2) exports `blindCast` and `castAs`; at least one workspace package imports them in production code.
- **AC2** — A representative bare `as Foo` cast added to production code fails CI via the ratchet, with a failure message naming the `file:line` and suggesting `blindCast`/`castAs`.
- **AC3** — A representative cast addition inside a test file (`**/*.test.ts`) does not fail CI.
- **AC4** — The current codebase's ~3,400 existing casts do not fail CI (because the ratchet compares delta against merge-base, not against zero).
- **AC5** — A representative cast *removal* in a PR decreases the count successfully (no false-positive failure on a net-zero or negative delta).
- **AC6** — `AGENTS.md § Typesafety rules` names `blindCast`, `castAs`, the lint rule, and links to the skill.
- **AC7** — `.cursor/rules/no-bare-casts.mdc` is present and discoverable.
- **AC8** — `skills-contrib/no-bare-casts/SKILL.md` is present, materializes to `.claude/skills/` and `.agents/skills/` via the `prepare` hook, and triggers on the documented surface.
- **AC9** — `blindCast`'s TSDoc comment carries the last-resort framing explicitly: names `blindCast` as a last resort, instructs the reader to rewrite first, references the reviewer's role in validating the `Reason`. Verifiable by reading `packages/0-shared/cast-utils/src/blindCast.ts`'s top-of-function TSDoc.

## Assumptions

These are the load-bearing assumptions of the settled design. If any falsifies mid-implementation, halt and route to `drive-discussion` per invariant I12.

- **A1** — Existing legitimate non-`as const` cast patterns (branded types, generic-bound casts in type helpers) are tolerable to route through `blindCast`/`castAs`. *Falsified if:* implementation reveals a pattern that is meaningfully worse under the helpers (e.g. type-inference loss that propagates widely).
- **A2** — Biome's plugin DSL can express the `as`-token recognition surface with the `as const` carve-out. ✓ **Confirmed** during D2 verification (commit `d8cb7f90a`): GritQL pattern `` `$x as $t` where { not $t <: r"^const$" } `` matches bare `as Foo` / `as unknown as Foo` while excluding `as const`. *Per-line `// biome-ignore` for plugin diagnostics was the original A2 sub-clause and was **falsified** (biome [#2582](https://github.com/biomejs/biome/issues/2582), "not in progress"); resolved by relocating the helper's escape to `any` instead of `as` — see [`./design-notes.md § Accepted trade-offs`](./design-notes.md#accepted-trade-offs).*
- **A3** — Biome's `--only=<rule-id>` flag works for plugin rules in addition to built-in rules in biome v2.4.14. ✗ **Falsified** during D2 verification: GritQL plugin diagnostics carry the opaque category `plugin` with no per-rule ID, and `--only=plugin` errors. *Fallback taken:* `--reporter=json` + `jq` filter on the `category` field (paired with a distinctive message prefix to future-proof against a second plugin being added). Recorded in [`./design-notes.md § Accepted trade-offs`](./design-notes.md#accepted-trade-offs).
- **A4** — `git worktree add --detach <merge-base>` is portable across the team's environments (macOS, Linux, CI runners). Standard git affordance; safe assumption.
- **A5** — The "convert when you touch" agent rule + skill is effective enough that the count materially decreases over a 1–3 month window. *If it doesn't:* the operator can elect a targeted sweep as future work.

## References

- Linear ticket: [TML-2685](https://linear.app/prisma-company/issue/TML-2685/forbid-casts)
- Reference utilities: [`./reference/`](./reference/) — `blindCast.ts`, `castAs.ts`, plus adjacent helpers (`assertExhausted.ts`, `assertPresent.ts`, `dontAwait.tsx`) for context but deferred to future work
- Design notes: [`./design-notes.md`](./design-notes.md) — settled design, principles, alternatives considered
- Existing typesafety rules: `AGENTS.md § Typesafety rules`
- Biome v2 custom plugins: implementer reads biome's plugin documentation when starting work (link TBD by implementer)

## Open Questions

- ~~**OQ1 — Biome plugin DSL expressiveness for the recognition surface.**~~ **Resolved during D2 A2 verification.** Recognition (including the `as const` carve-out) is expressible; per-line `// biome-ignore` suppression of plugin diagnostics is not. The helper's body no longer uses `as`, so no plugin-suppression is needed; the `as const` carve-out lives in the GritQL pattern.
- ~~**OQ2 — Helper package name.**~~ **Resolved in D1.** Package landed as `@prisma-next/cast-utils` (commit `567473b88`).
- ~~**OQ3 — Biome rule ID.**~~ **Resolved during D2 A2 verification.** GritQL plugin diagnostics carry the opaque `category: "plugin"` with no per-rule ID; the rule is identified by its source file path (`biome-plugins/no-bare-cast.grit` or equivalent — implementer picks the final location) and disambiguated downstream by message-text matching.
- **OQ4 — Per-site error message format.** *Working position:* `file:line — replace with blindCast<T, "reason">(...) or castAs<T>(value)`. The wrapper script doesn't have type information to know which helper applies, so the message suggests both. Implementer can refine.
