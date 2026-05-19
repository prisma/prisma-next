# Drive · Code Review — Prisma Next

Project-context bootstrap used by the `drive-code-review` and `drive-pr-local-review` skills when authoring reviews against this repo. Skill bodies stay generic; this file carries repo-specific review knowledge.

## How to use this file

`drive-code-review` and `drive-pr-local-review` both delegate to architect / principal-engineer / tech-lead personas. Each delegated subagent should read this file before starting its pass and surface any of the listed smells if they appear in the diff under review.

## Repo-specific smells to surface

These are bypass-the-seam patterns that look fine in isolation but encode a class of bugs the codebase has already paid for. Cross-reference the linked rule files when flagging the smell so the comment has a permanent home for the rationale.

- **`as Contract` cast bypasses the family `ContractSerializer` seam.** Any `JSON.parse(...) as Contract` (or `as Contract<…>`) in `packages/**/src/**` outside the allowlist is a serializer-bypass smell — see [`.cursor/rules/as-contract-cast-smell.mdc`](../../.cursor/rules/as-contract-cast-smell.mdc) and [`.cursor/rules/contract-normalization-responsibilities.mdc`](../../.cursor/rules/contract-normalization-responsibilities.mdc). The replacement idiom is `validateContract<Contract>(JSON.parse(raw) as unknown)`. Originally surfaced by `TML-2536`.

## When this file should change

Append (rather than overwrite) when any of the following surface during a code review:

- A new repo-specific smell that the standard review heuristics would miss.
- A change in rule-file location that breaks a link above.
- A new allowlist policy or rule-enforcement guard that reviewers should reference.

Reduce or remove (with explanation) when an entry is no longer relevant (e.g. the rule it references has been retired).
