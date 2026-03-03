# Summary

Add a PSL grammar extension for **inline SQL literals** using JavaScript/TypeScript-style backticks (`sql\`...\``), with **no interpolation** and **multiline** support, and use it as the preferred future-facing way to embed SQL snippets in PSL (starting with storage defaults).

# Description

Milestone 5 introduced `dbgenerated("...")` as a storage-default escape hatch to achieve TS parity. While functional, it hides SQL content inside a quoted string and makes syntax highlighting and future SQL-embedding features (views, special indexes, computed expressions) harder to represent ergonomically.

This milestone adds a first-class PSL literal form for SQL snippets that:
- looks like the authoring experience in TS/JS (`sql\`...\``),
- is easy for language tooling to highlight as SQL, and
- is explicit about “this is SQL embedded in PSL” without requiring attribute-specific magic.

This is intentionally **not** a templating mechanism: interpolation is disallowed.

# Requirements

## Functional Requirements

- Extend `@prisma-next/psl-parser` grammar to parse tagged template literals (including multiline) in attribute arguments:
  - Accept `sql\`...\`` as an argument value in `@default(...)` (and generally as a generic argument value).
  - Keep PSL parser **SQL-agnostic**: the backtick-enclosed content is treated as opaque text.
  - The set of permitted template tags (e.g. `sql`) is configurable/parameterized at the parser boundary so language tooling can highlight based on the tag without hardcoding SQL into PSL.
  - Disallow interpolation sequences (e.g. `${...}`) and report a targeted syntax/diagnostic error.
  - Define and implement escaping rules for backticks inside the literal (e.g. `\``).
- Extend `@prisma-next/sql-contract-psl` interpretation to support storage defaults written with `sql\`...\``:
  - `@default(sql\`gen_random_uuid()\`)` lowers to a storage default `{ kind: 'function', expression: 'gen_random_uuid()' }`.
  - Preserve deterministic behavior and stable diagnostic spans.
- Add fixture-driven parity and diagnostics coverage:
  - A parity case using `sql\`...\`` that matches the equivalent TS authoring fixture.
  - A diagnostics case for forbidden interpolation inside `sql\`...\``.
  - A diagnostics case for malformed/unterminated backtick literals with spans.

## Non-Functional Requirements

- **No interpolation**: `sql\`...\`` is a quoting mechanism, not a templating language.
- **Multiline allowed**: newlines are permitted inside the literal and spans/diagnostics must be correct.
- **Tooling-friendly**: the token shape should make it easy for a language server/highlighter to highlight backtick regions as SQL.

## Non-goals

- `${...}` interpolation semantics.
- Adding view/index DSL or additional PSL blocks in this milestone (the syntax should enable them later, but this milestone proves the path via storage defaults first).
- Changing the contract model (this is syntax + lowering only).

# Acceptance Criteria

- [ ] Parser accepts `sql\`...\`` in attribute arguments and produces correct spans.
- [ ] Interpreter lowers `@default(sql\`...\`)` to a storage default expression in Contract IR / emitted contract.
- [ ] Interpolation is rejected with a targeted diagnostic and correct span.
- [ ] Parity fixture demonstrates canonical `contract.json` equality (and stable hash equality) vs TS fixture for an equivalent storage default.

# References

- Project spec: `projects/psl-contract-authoring/spec.md`
- Project plan: `projects/psl-contract-authoring/plan.md`
- Gap inventory: `projects/psl-contract-authoring/references/authoring-surface-gap-inventory.md`
- ADR (proposed): `projects/psl-contract-authoring/references/ADR - PSL sql template literals.md`

