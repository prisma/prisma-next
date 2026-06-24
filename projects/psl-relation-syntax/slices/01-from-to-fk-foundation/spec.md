# Slice 1: from/to FK foundation + formatter rewrite

_Parent project: `projects/psl-relation-syntax/`. Linear: [TML-2940](https://linear.app/prisma-company/issue/TML-2940). Foundation slice — gates S2–S5. Design: `projects/psl-relation-syntax/design-notes.md` decisions **D1**, **D3**._

## At a glance

PSL foreign-key relations gain the canonical directional vocabulary `@relation(from:, to:)`. Legacy `@relation(fields:, references:)` keeps parsing as an **input alias** that lowers to the same contract; the toolchain only ever **emits** the canonical spelling. This slice is FK-only (1:N / N:1) — `through:`/`inverse:`/M:N are later slices. Its headline is the **backward-compat invariant**: legacy and canonical spellings lower to byte-identical contracts.

```prisma
// these two lower to byte-identical contract.json
user User @relation(fields: [userId], references: [id])   // legacy (input only)
user User @relation(from: userId)                          // canonical (to: omitted ⇒ target @id)
```

## Chosen design

Settled in design-discussion (D1, D3) — not re-opened here.

The `@relation` attribute grammar is **generic**: named arguments are scanned by string in the resolver (`getNamedArgument(attribute, 'fields')`). So accepting `from:`/`to:` needs **no parser/grammar change**. Three surfaces:

1. **Resolver read** — `packages/2-sql/2-authoring/contract-psl/src/psl-relation-resolution.ts` (`parseRelation`, ~L192–237). Read `from:`/`to:`; accept legacy `fields:`/`references:` as aliases lowering to the **same** `{ fields, references }` result. Inference: omit `to:` ⇒ the target model's `@id`; a single field is bare (`from: userId`), composites bracketed (`from: [a, b]`), brackets required when composite; a redundant `Model.` qualifier on `to:` (e.g. `to: Post.id`) is tolerated and preserved. Keep the existing "both-or-neither" diagnostic (a `from:` without a `to:` is only an error when the target has no inferable `@id`).
2. **CST format emit** — `packages/1-framework/2-authoring/psl-parser/src/format/`. The formatter is a token-streamer over the red/green CST (`emit.ts`, `emitDocument` → `streamNode` writes each token's text verbatim, normalising only whitespace/indent/alignment). Canonicalisation is therefore a **CST-level key-token rename** (`fields`→`from`, `references`→`to` inside `@relation` argument keys) applied before/within streaming — **keyword token only**; values, brackets, qualifiers, and comments/trivia are untouched (D3). This is the slice's one real implementation judgment (see § Open questions: tree-rewrite vs streaming substitution hook).
3. **AST printer emit** — `packages/1-framework/2-authoring/psl-printer/` (`ast-to-print-document.ts`) and/or the IR→PSL-AST step `packages/2-sql/9-family/src/core/psl-contract-infer/sql-schema-ir-to-psl-ast.ts`, used by `contract infer`. Emit `from:`/`to:` (not `fields:`/`references:`) when rendering a relation from an inferred schema.
4. **Validation** — accept `from:`/`to:` as known relation arguments; legacy keys still accepted on input.

## Coherence rationale (slice-INVEST · _Small_)

One coherent outcome — "the `from`/`to` FK vocabulary, end-to-end: read it, format it, print it" — matching the repo's clean **"one new authoring surface end-to-end"** slice pattern. The three surfaces are not three outcomes: they are the read / format / print faces of a single vocabulary, and a reviewer holds them as one idea ("does the toolchain speak `from`/`to` for FKs, and does legacy still mean the same thing?"). The backward-compat equivalence test is the spine that ties them together. *If at plan time the CST normalize pass proves heavier than a single review can hold alongside the rest, split it into its own slice with the resolver-read as its hand-off* — it is the most separable piece.

## Scope

**In:** `from:`/`to:` read in the resolver with legacy aliasing + inference (omit-`to:`, bare-vs-bracketed, tolerated `Model.` qualifier); CST `format` keyword-only canonicalisation preserving trivia; AST printer / IR→PSL-AST canonical emit; validation; the backward-compat-equivalence + formatter-idempotence + no-legacy-emitted tests; any fixture wiring needed to prove equivalence.

**Out:** `through:` / `inverse:` / any M:N (S2–S3); `@relation(name:)` retirement (S3 — it stays emitted-as-today here); aggressive canonicalisation — dropping an inferable `to:`, stripping a redundant `Model.`, normalising brackets (project non-goal, D3); the TS contract builder; migrating a demo to canonical syntax (a later slice / the demo slice).

## Pre-investigated edge cases

| Edge case | Disposition |
|---|---|
| Composite FK (`from: [a, b]`, `to: [x, y]`) | brackets required; order-significant; lowers identically to `fields:`/`references:` arrays |
| `to:` omitted | infers the target model's `@id`; if the target has no `@id`, the existing both-or-neither diagnostic still fires |
| Redundant `Model.` qualifier on `to:` (`to: Post.id`) | tolerated on input; preserved verbatim by `format` (D3 — not stripped) |
| Self-referential FK | `from`/`to` resolve the same as legacy; no special path |
| Optional vs required relation (`User?` / `User`) | orthogonal to the arg vocabulary; unchanged |
| Comment/trivia on a `@relation` line being canonicalised | must survive the key rename (the CST streamer already preserves comments; the rename must not disturb them) |
| Mixed legacy+canonical in one schema | each relation lowers independently; `format` migrates every legacy occurrence |

## Slice-specific done conditions

- [ ] **Backward-compat invariant:** a fixture schema authored with legacy `fields:`/`references:` and the same schema authored with canonical `from:`/`to:` lower to **byte-identical** `contract.json` (the test asserts equality, not two separate snapshots).
- [ ] **Single-dialect output:** `prisma-next format` and `contract infer` emit `from:`/`to:` and never `fields:`/`references:` — a grep gate over their output asserts no legacy relation keys remain.
- [ ] **Formatter idempotence:** `format(format(x)) == format(x)` for a schema containing relations (including a legacy one, which becomes canonical on the first pass and stable thereafter).

_(CI-green, reviewer-accept, and the project-DoD floor cover the rest.)_

## Open questions

1. _CST canonicalisation mechanism: rewrite the green tree (produce a new document with renamed key tokens) vs. a streaming substitution hook in `emitDocument`/`streamNode` keyed on the `@relation` argument-key node._ Working position: prefer the smallest change that keeps `emitDocument` generic — a targeted key-token substitution scoped to relation-attribute argument keys, decided at dispatch against the green-tree mutability constraints. Settle in the slice plan.

## References

- Project: `projects/psl-relation-syntax/spec.md`, `design-notes.md` (D1, D3).
- Surfaces: `contract-psl/src/psl-relation-resolution.ts` (`parseRelation`); `psl-parser/src/format/{format,emit}.ts`; `psl-printer/src/ast-to-print-document.ts`; `packages/2-sql/9-family/src/core/psl-contract-infer/sql-schema-ir-to-psl-ast.ts`; CLI `commands/format.ts`.
- Sibling fixture/test patterns: `projects/sql-orm-many-to-many/` (integration-test standard).
