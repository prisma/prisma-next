# Drive · Code Review — Prisma Next

Project-context bootstrap used by the `drive-code-review` and `drive-pr-local-review` skills when authoring reviews against this repo. Skill bodies stay generic; this file carries repo-specific review knowledge.

## How to use this file

`drive-code-review` and `drive-pr-local-review` both delegate to architect / principal-engineer / tech-lead personas. Each delegated subagent should read this file before starting its pass and surface any of the listed smells if they appear in the diff under review.

## Repo-specific smells to surface

These are bypass-the-seam patterns that look fine in isolation but encode a class of bugs the codebase has already paid for. Cross-reference the linked rule files when flagging the smell so the comment has a permanent home for the rationale.

- **`as Contract` cast bypasses the family `ContractSerializer` seam.** Any `JSON.parse(...) as Contract` (or `as Contract<…>`) in `packages/**/src/**` outside the allowlist is a serializer-bypass smell — see [`.cursor/rules/as-contract-cast-smell.mdc`](../../.cursor/rules/as-contract-cast-smell.mdc). The replacement idiom is `familyInstance.deserializeContract(JSON.parse(raw) as unknown)`. Originally surfaced by `TML-2536`.

- **Self-acknowledged layering violation in source.** A code comment that explicitly admits to a known anti-pattern (`layering violation`, `branch on target`, `leaky abstraction`, `bypasses the seam`, `we shouldn't do this but`, `temporary`, `TODO: this is wrong`) is *itself* the must-fix finding — flag it as `must-fix` and stop reviewing the surrounding diff until the operator confirms whether the shape is correct. Reviewers should grep the diff for these phrases as part of every review pass. The implementer's acknowledgment is the symptom; the underlying structural problem is the actual finding. See [F16 in `drive/calibration/failure-modes.md`](../calibration/failure-modes.md#f16-self-acknowledged-layering-violation-shipped-through-review). Originally surfaced by `TML-2753`.

- **Inverted abstraction: shared template-method orchestrator over adapter fragments.** A type named `<Operation>Shape` / `<Operation>Statements` / `<Operation>Spec` in `family-sql` (or any shared layer) carrying SQL fragments + row decoders populated by each adapter, plus a function that takes a queryable + that shape and runs the operation — that's the adapter exporting its implementation details upstream instead of owning the operation. The adapter exists to hide those details. Right shape: each adapter owns `<operation>(driver, args)` end-to-end; only *pure* helpers (parsers, row-shape schemas) are shared. 10–20 lines of "duplicated" orchestration between two adapters is the right kind of duplication — it's what the adapter pattern is for. Symmetry check: if the *write* side or the sibling *Mongo* family owns the operation end-to-end, the read side or SQL side must too. See [F18 in `drive/calibration/failure-modes.md`](../calibration/failure-modes.md#f18-inverted-abstraction-shared-orchestrator-in-family-layer-takes-adapter-implementation-detail-fragments-via-an-interface). Originally surfaced by `TML-2753`.

- **Single-primitive collapse without per-caller contract trace.** A diff that collapses two distinct operations into one primitive (`initMarker` becomes upsert, replacing separate insert + update; `merge` replaces separate overwrite + accumulate) must explicitly enumerate every caller of either pre-collapse operation and confirm the post-collapse semantic still satisfies each caller's contract. Look for: caller A's tests pinning idempotent-re-apply (passes under upsert), caller B's tests pinning fail-loudly-on-duplicate (might still pass sequentially while failing under concurrency). The mitigation is either keeping both operations or adding an explicit variant (e.g. `insertMarker` alongside upsert-`initMarker`). See [F19 in `drive/calibration/failure-modes.md`](../calibration/failure-modes.md#f19-single-primitive-collapse-changes-semantics-for-some-callers-but-not-others). Originally surfaced by `TML-2753`.

## When this file should change

Append (rather than overwrite) when any of the following surface during a code review:

- A new repo-specific smell that the standard review heuristics would miss.
- A change in rule-file location that breaks a link above.
- A new allowlist policy or rule-enforcement guard that reviewers should reference.

Reduce or remove (with explanation) when an entry is no longer relevant (e.g. the rule it references has been retired).
