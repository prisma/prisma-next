# Drive · Code Review — Prisma Next

Project-context bootstrap used by the `drive-code-review` and `drive-pr-local-review` skills when authoring reviews against this repo. Skill bodies stay generic; this file carries repo-specific review knowledge.

## How to use this file

`drive-code-review` and `drive-pr-local-review` both delegate to architect / principal-engineer / tech-lead personas. Each delegated subagent should read this file before starting its pass and surface any of the listed smells if they appear in the diff under review.

## Reviewers don't run validation gates

**CI is the authority on the validation gates** (`typecheck`, `lint:deps`, `lint:casts`, `test:*`, `fixtures:check`, DCO). A reviewer does **not** re-run them — re-running CI's gates on a reviewer's machine burns CI-equivalent compute a second time (acutely so when several reviews run in parallel) and tells the reviewer nothing CI hasn't already decided. If a gate is red, that's the implementer's to fix before the review even starts.

The reviewer's job is **judgment** CI can't make: architectural soundness, the seam smells listed below, correctness reasoning, clarity, whether the change matches its spec. Read the diff and reason about it; trust the green check for the mechanical gates.

The mirror of this rule sits on the implementer side: the implementer runs gates **selectively** while working (only what the change touches) and the **full suite once at the end** of a dispatch — not repeatedly. CI is the final word for everyone; local runs are for fast iteration, not for re-certifying what CI will certify.

(Sign-off/DCO is also CI-owned and not a reviewer gate — see [`drive/pr/README.md § Sign-off (DCO) is a pre-push responsibility`](../pr/README.md#sign-off-dco-is-a-pre-push-responsibility-not-a-reviewer-gate).)

## Repo-specific smells to surface

These are bypass-the-seam patterns that look fine in isolation but encode a class of bugs the codebase has already paid for. Cross-reference the linked rule files when flagging the smell so the comment has a permanent home for the rationale.

- **`as Contract` cast bypasses the family `ContractSerializer` seam.** Any `JSON.parse(...) as Contract` (or `as Contract<…>`) in `packages/**/src/**` outside the allowlist is a serializer-bypass smell — see [`.cursor/rules/as-contract-cast-smell.mdc`](../../.cursor/rules/as-contract-cast-smell.mdc). The replacement idiom is `familyInstance.deserializeContract(JSON.parse(raw) as unknown)`. Originally surfaced by `TML-2536`.

- **`blindCast()` usages — be hyper-vigilant; the `Reason` must sell _why_ the type system was unusable.** Every `blindCast<T, 'reason'>` is a deliberate hole in the type system, so each one is guilty until proven innocent. For every `blindCast` in the diff, the reviewer applies two tests, in order:
  1. **Could the caller have used the type system instead?** If a typed alternative exists — a proper field type, a discriminated-union narrowing, a type guard / `is`-predicate, threading the concrete family type (e.g. `SqlNamespace` instead of the framework `Namespace`), or fixing an upstream type — then the `blindCast` must be **removed**, not re-justified. A `blindCast` is a last resort, never a convenience.
  2. **Does the `Reason` string actually explain _why_?** A reason that merely **restates what is being cast** (the target shape, the field name, "envelope slot", "index slot") is **inadequate** and must be rejected. The reason must name the **structural reason the type cannot be expressed statically** — e.g. an open `Record<string, unknown>` extensibility bag that target packs populate at runtime; a JSON / introspection boundary where the static type is erased to `unknown`; an arktype validator whose output is `unknown` by construction — **and** why no typed accessor is available at that seam. If a reader can't tell from the reason why the type system genuinely couldn't be used, the cast fails review.

  Worked example (rejected → required): `blindCast<{ schema?: string } | undefined, 'pg annotation envelope index slot'>(...)` — "pg annotation envelope index slot" only names what is being indexed; it says nothing about why the caller couldn't type it. Either type the annotation accessor, or, if `annotations` is genuinely an open target-pack-extensible `Record<string, unknown>`, the reason must say exactly that and why the framework type cannot know the `pg` slot's shape.

## When this file should change

Append (rather than overwrite) when any of the following surface during a code review:

- A new repo-specific smell that the standard review heuristics would miss.
- A change in rule-file location that breaks a link above.
- A new allowlist policy or rule-enforcement guard that reviewers should reference.

Reduce or remove (with explanation) when an entry is no longer relevant (e.g. the rule it references has been retired).
