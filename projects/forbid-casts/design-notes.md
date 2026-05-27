# Design notes: forbid-casts

> Synthesized design document for `forbid-casts`. Read this if you want to understand **what the project's design is**, **what principles it serves**, and **what alternatives were considered and rejected**. This document captures the settled design, standing independently of the discussion that produced it.
>
> Owned by the Orchestrator. Authored directly (not delegated — see [`drive/roles/README.md § Orchestrator-direct authoring`](../../drive/roles/README.md)). Updated as design settles; not as decisions happen. Cross-linked from [`./spec.md`](./spec.md); never block on a design-notes update during execution.

## Principles this design serves

- **Casts must be visible.** An unjustified cast must not be insertable by accident or omission. The rule turns silent compromise into explicit compromise.
- **Rewrite first; cast as last resort; reviewer validates the justification.** When an author (agent or human) reaches for `blindCast`, the first action is to ask whether the code can be rewritten so the cast becomes unnecessary. Only when no rewrite is feasible does the cast happen, and the `Reason` literal must articulate the compromise in language a reviewer can evaluate. An unconvincing `Reason` is the reviewer's signal to push back — and the author's signal to go solve the underlying type-system problem properly. `blindCast` is **not** a sanctioned tool to reach for; it is the auditable escape hatch when everything else has been tried.
- **Compromise must be named at the call site.** When `blindCast` is the right answer, the `Reason` literal forces the author to articulate what guarantee they're giving up — at the cast site, where future readers will find it.
- **Mechanical recognition beats reviewer judgement.** The rule fires on a syntactic token (`as`), not on intent. The reviewer never has to relitigate "is this cast OK?" The only mental load is "is this `blindCast` reason good enough?" — which is a much sharper question.
- **The escape hatches must remain.** Some casts are genuinely necessary (type-system gaps, third-party typing, generic-bound limitations). `blindCast` and `castAs` are the named, auditable escape hatches.
- **Agents pay the same cost as humans.** The rule is symmetric: an LLM agent that wants to add a cast must invent and commit to the same justification a human would. The agent rule + skill educate; the lint rule enforces.
- **Incrementalism over heroics.** A 3,400-site sweep is unreviewable; a ratchet that drives the count down over time via incidental contact is auditable per-PR and resilient to refactor noise.

## The model

### Recognition surface

The biome custom rule fires on the syntactic `as` token in production code. The carve-outs are exactly two:

1. **`as const`** — pass-through. It's a syntactic operator producing a `readonly` literal type, not a type assertion. (Biome already enforces `useAsConstAssertion`; this rule complements rather than conflicts.)
2. **One in-file exception inside `blindCast.ts`** — the helper's body (`return input as TargetType`) is the one legitimate `as Foo` in the repo. Covered by an in-file `// biome-ignore lint/casts/no-bare-cast: this is the helper itself` comment.

Everything else — `as Foo`, `as unknown as Foo`, `as never`, `as Brand<…>`, generic-constrained casts in type helpers, `<T>x` (the old angle-bracket form), etc. — must be eliminated or routed through `blindCast` / `castAs`.

`satisfies`, `asserts value is T`, and type predicates (`x is Foo`) are different keywords and unaffected by the rule.

### Two helpers

- **`blindCast<T, Reason extends string>(input: unknown): T`** — for casts where the input is genuinely opaque relative to the target. Generic constraint `Reason extends string` forces a string literal at the call site; the literal isn't used at runtime but is grep-able and visible to future readers. Reference implementation: [`./reference/blindCast.ts`](./reference/blindCast.ts).

- **`castAs<T>(value: T): T`** — for casts where the value already satisfies the type but the author wants to make the type assertion explicit. Runtime pass-through; no actual cast. Reference implementation: [`./reference/castAs.ts`](./reference/castAs.ts).

The split is intentional: `blindCast` is for the unsafe case (input is `unknown` or unrelated to target); `castAs` is the type-checked named-form. Authors picking the right helper at the call site provides one more signal to the reviewer about what the cast is doing.

Both live in a new `packages/0-shared/cast-utils/` package (final name per OQ2 in spec).

### Ratchet (compare-to-merge-base)

CI counts cast-rule violations at HEAD and at `git merge-base origin/main HEAD`. Fails if HEAD's count exceeds the merge-base count. Skipped on `main` itself.

Mechanism:

1. Run `biome check --only=lint/casts/no-bare-cast --reporter=json` on HEAD. Parse the diagnostic list; count.
2. Materialize merge-base in a fresh worktree: `git worktree add --detach <merge-base>`.
3. Run the same biome invocation in the merge-base worktree. Count.
4. Compare. If HEAD > merge-base, fail with per-site diagnostics for the *added* casts.
5. Remove the worktree.

Key properties:

- **No baseline file.** Source of truth is the code at merge-base, not a committed artefact. Compare-to-merge-base eliminates the maintenance + agent-defeat surface a `.cast-baseline` file would introduce.
- **No working-tree mutation.** `git worktree add --detach` materializes merge-base in a separate directory; no `git stash` / `git checkout` dance.
- **Implicit ratcheting.** Every PR that removes a cast decreases main's count after merge; subsequent PRs are judged against the new lower number with no extra ceremony.

### Test exclusion

Biome's existing test-file `overrides` block (the one already disabling `noNonNullAssertion` for `**/*.test.ts`, `**/*.test-d.ts`, `**/test/**/*.ts`) gets the cast rule turned off. Tests routinely use casts for stubbing, narrowing, and negative type assertions; enforcing the rule there imposes friction with no review benefit.

### Three agent surfaces

- **`.cursor/rules/no-bare-casts.mdc`** — Cursor rule fires on every TS-touching agent context. Documents the contract: forbid bare `as`, reach for `blindCast`/`castAs`/`satisfies`/type-tightening, "convert when you touch."
- **`skills-contrib/no-bare-casts/SKILL.md`** — skill fires when an agent is about to write `as` or touches an existing cast site. Educates about the alternatives at the moment of action. Materializes to `.claude/skills/` and `.agents/skills/` via the existing `prepare` hook.
- **`AGENTS.md § Typesafety rules`** — updated to point at the helpers, the rule, and the skill. Primary discovery surface for fresh agents.

The lint rule prevents *new* abuses; the agent surfaces drive the count *down* over time via incidental conversion.

## Alternatives considered

- **Carved recognition** (whitelist legitimate patterns case-by-case). **Rejected because:** relitigates "is this cast OK?" in every PR review and re-opens the judgement-call space the rule is meant to close. Maximalist recognition is mechanically simpler and forces every author to pick one of the named escape hatches.

- **`.cast-baseline` file committed to the repo.** **Rejected because:** (a) the file is editable from inside the PR — an agent could try to bypass the ratchet by editing the baseline in the same commit (agent-defeat surface); (b) maintenance overhead (decrement after refactor; merge conflicts on the baseline when two PRs both decrease the count); (c) compare-to-merge-base is strictly better: no file, no maintenance, no agent-defeat surface, implicit ratcheting.

- **Per-file ratchet.** **Rejected because:** incentivizes delete-here-add-there agent defeat (delete an unrelated cast in file A; add the cast you wanted in file A as net-zero). Whole-repo count survives this. Per-file ratchet also breaks under file renames.

- **ts-morph standalone script as the primary path.** **Held as fallback** if biome's plugin DSL can't express the recognition surface (A2 in spec). Not chosen as primary because biome is the existing lint home; the GritQL learning cost amortises against future custom rules.

- **Ripgrep / regex count.** **Rejected because:** the word "as" appears in comments, string literals, and English prose; regex isn't AST-aware. False positives would force a brittle exclusion list.

- **`satisfies` in the carve-out list.** **Caught and rejected mid-discussion** — `satisfies` is its own keyword, not `as`. It doesn't appear on the rule's radar at all. The agent's initial carve-out list had a category error (operator caught it). The actual `as`-token carve-out list is just `as const`.

- **`assertPresent` + `assertExhausted` + `dontAwait` in scope.** **Deferred** — adjacent helpers in the same family (reference utilities included), but they displace different escape hatches (`!`, exhaustiveness, floating promises) that this rule doesn't target. Out of scope for this slice; possibly future work.

- **Mass sweep of all ~3,400 existing cast sites.** **Rejected because:** risk too high (3,400 mechanical conversions; behavioural regressions plausible), value duplicated by ratchet + agent guidance. The "convert when you touch" expectation achieves the same end state over time without the risk.

- **Promoting `satisfies` over `as Foo` via a separate rule.** **Out of scope.** Authors can still use `as` for type-checked cases and the rule fires; the fix is `castAs` (or `satisfies` if the author prefers). Future work could add a `prefer-satisfies` rule if it proves worth it.

## Open questions

Working positions live in [`./spec.md § Open Questions`](./spec.md#open-questions). The discussion resolved the load-bearing ones; the four remaining are implementer-decided or verify-by-prototype.

- **OQ1 — Biome plugin DSL expressiveness.** Working position: biome's plugin syntax (GritQL or whichever DSL biome v2.4.14 ships) can express the recognition surface. Verification: small prototype before committing. Fallback: ts-morph.
- **OQ2 — Helper package name.** Working position: `cast-utils`. Alternatives: `typesafe-utils`, `type-escapes`. Implementer-decided.
- **OQ3 — Biome rule ID.** Working position: `lint/casts/no-bare-cast`. Implementer-decided per biome plugin convention.
- **OQ4 — Per-site error message format.** Working position: `file:line — replace with blindCast<T, "reason">(...) or castAs<T>(value)`. Implementer can refine.

## Accepted trade-offs

- **Agent defeat via delete-here-add-there.** Whole-repo count survives this; an agent who *really* wants to add a cast could delete an unrelated one as a net-zero move. We tolerate it: the case is rare, the agent rule + skill catch it on review, and per-file ratcheting is worse on more axes.
- **`satisfies` not actively promoted.** Outside this rule's scope. Authors who prefer `satisfies` can use it; authors who don't get the lint rule's `as`-token failure and reach for `castAs` instead. Future work could promote `satisfies` more aggressively.
- **Test-code casts unbounded.** Tests routinely abuse `as` for stubbing; we accept this in exchange for not having to retrofit every test. If a future agent disguises production code as test code to bypass the rule, that's a real bug, not a rule gap.

## References

- Project spec: [`./spec.md`](./spec.md)
- Project plan: [`./plan.md`](./plan.md)
- Linear ticket: [TML-2685](https://linear.app/prisma-company/issue/TML-2685/forbid-casts)
- Reference utilities (inputs): [`./reference/`](./reference/)
- Existing typesafety conventions: `AGENTS.md § Typesafety rules`
- Biome v2 plugin documentation: implementer reads when starting the slice
