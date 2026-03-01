## Status

Proposed.

## Context

We want PSL-first contract authoring in Prisma Next to support embedding SQL expressions in a way that is:
- explicit about “this is SQL embedded in PSL”
- ergonomic for authors
- easy for language tooling (syntax highlighting, diagnostics)
- future-facing for additional SQL embedding sites (views, special indexes, computed expressions)

In Milestone 5 we introduced support for `@default(dbgenerated("..."))` to express storage defaults such as `gen_random_uuid()`. While effective, this representation:
- hides SQL inside a quoted string,
- makes SQL highlighting dependent on knowing the semantics of `dbgenerated("...")`, and
- does not generalize cleanly to other future SQL embedding surfaces without more attribute-specific behavior.

## Decision

Add a PSL grammar extension for a SQL template-literal-like syntax:

- `sql\`...\``

Rules:
- **Single-line only** (no embedded newlines)
- **No interpolation**: `${...}` is explicitly rejected (PSL is not a templating language)
- Supports escaping a backtick within the literal (e.g. `\``) per the parser’s defined escaping rules.

Initial supported site:
- `@default(sql\`...\`)` for storage default expressions.

Lowering:
- `@default(sql\`gen_random_uuid()\`)` lowers to the existing storage default shape:
  - `{ kind: 'function', expression: 'gen_random_uuid()' }`

## Rationale

- **Explicitness**: backticks provide an unambiguous “embedded language” cue.
- **Ergonomics**: syntax matches TS/JS mental model for “inline SQL snippet” (while explicitly not supporting interpolation).
- **Tooling**: language servers can highlight backtick-delimited regions as SQL without needing semantic knowledge of specific functions like `dbgenerated`.
- **Extensibility**: creates a reusable syntactic building block for future features needing inline SQL without multiplying ad-hoc string conventions.

## Consequences

- This is a **PSL language change**:
  - parser grammar updates
  - diagnostics + spans behavior must be correct and stable
  - downstream consumers should not assume attribute argument values are limited to identifiers, numbers, or quoted strings
- By choosing **single-line only**, we avoid (for now) complex span/position mapping across multi-line literals.

## Alternatives considered

1. **Keep `dbgenerated("...")` only**
   - Pros: no grammar change
   - Cons: poor SQL highlighting ergonomics; attribute-specific magic; doesn’t generalize to other SQL embedding sites

2. **Add `sql("...")` as a string-literal function**
   - Pros: no backtick literal; still explicit
   - Cons: still hides SQL inside a quoted string; highlighting still depends on semantic knowledge of `sql(...)`

3. **Allow multiline + interpolation**
   - Pros: maximum expressiveness
   - Cons: high complexity; misleading similarity to JS template semantics; easy to introduce unsafe or non-deterministic expectations

## Scope / rollout

Implement as a follow-up milestone (Milestone 7) after default-function parity is complete.

Initial rollout constraints:
- single-line only
- no interpolation
- only supported inside `@default(...)` lowering for storage defaults

Future expansion (explicitly out of scope for this ADR’s initial implementation):
- views
- special index expressions/predicates
- computed columns
- richer SQL embedding sites with explicit namespace/prefix forms (e.g. `storage.sql\`...\``) if needed

