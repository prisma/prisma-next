# Design notes: psl-relation-syntax

> Synthesized design document for `psl-relation-syntax`. Read this if you want to understand **what the project's design is**, **what principles it serves**, and **what alternatives were considered and rejected**. This document is not a chronological log of decisions — it captures the settled design, standing independently of the discussions that produced it.
>
> Owned by the Orchestrator. Authored directly. **Status: grammar settled (D1–D5) via `drive-discussion`, 2026-06-24. Slice-level mechanics deferred to slice specs.**

## Principles this design serves

- **Directionality reads naturally** — a relation is "from these local fields to that referenced key"; the vocabulary says so.
- **Omit what can be inferred** — single fields need no brackets; a referenced `@id` needs no explicit `to:`; an unambiguous junction is named on one end only.
- **No silent break** — legacy `fields:`/`references:`/`@relation(name:)` keep parsing; they are input-only and never survive a round-trip.
- **Disambiguate by pointing, not by naming** — replace the free-floating `@relation(name: "...")` string with a direct reference to the relation field.
- **Explicit over magic** — junction synthesis fires only when there is genuinely no junction to find; an authored junction is never silently ignored.

## The model

Canonical vocabulary on `@relation`:

- `from:` — local FK field(s). Bare for a single field (`from: userId`); bracketed for composites (`from: [followerId, ...]`), brackets required when composite.
- `to:` — the referenced key. Omitted ⇒ infer the target's `@id`. Bare single field or bracketed list. A redundant `Model.` qualifier (`to: Post.id`) is tolerated and preserved verbatim; true cross-model qualified paths belong to the arrow-path slice.
- `through:` — the junction for the navigable M:N side. Named on **one** end when unambiguous (the inverse list field is inferred by type-match); on **both** ends with a relation-field path (`through: Follow.follower`) only to disambiguate self-relations or multiple M:N between the same pair of models.
- `inverse:` — the 1:N back-relation's pointer at the inverse FK field, used only to disambiguate when multiple relations link the same pair of models (`posts Post[] @relation(inverse: editor)`).

### Decisions

- **D1 — Single canonical keyword spelling; legacy input-only.** The whole toolchain always emits `from`/`to`/`through`/`inverse`. `fields:`/`references:`/positional-and-`name:` parse on input but never survive a round-trip. Both emit surfaces — the CST `format` command (`@prisma-next/psl-parser`'s `format/`) and the AST printer (`@prisma-next/psl-printer`) used by `contract infer` — render the canonical spelling. The `@relation` grammar is generic (named args scanned by string), so **no parser/grammar change is needed to accept the new keywords**.
- **D2 — Retire `@relation(name:)` entirely.** Disambiguation is by pointing: `from`/`to` (FK declaration), `through:` (M:N junction side), `inverse:` (1:N back side). One mechanism per case; no string survivor across cardinalities.
- **D3 — Conservative canonicalisation: keyword migration only.** `format`'s CST normalize pass swaps the argument *name* token (`fields`→`from`, `references`→`to`) and preserves everything else — values, brackets, redundant `Model.` qualifiers, comments/trivia. It does **not** drop inferable args or strip qualifiers ("single canonical" governs keywords, not inference depth). Aggressive normalisation is a possible future, out of scope here.
- **D4 — `through:` on one end; infer the inverse.** Unambiguous M:N: one navigable end declares `through: Junction`, the other's inverse list is inferred. Ambiguous (self-relation / multiple M:N between the same models): both ends declare and disambiguate via `through: Junction.relationField`.
- **D5 — Bare-list precedence (backward-compatible).** Resolving a bare list (`Tag[]`): (1) other end has `through:` → this is its inferred inverse; (2) both ends bare **and** a junction model links them → recognise that authored junction (preserves shipped slice-5 behaviour); (3) both ends bare **and** no junction model → synthesise a model-less junction table (implicit M:N).

### Provisional slice slate

1. `from`/`to` FK foundation: accept legacy as input, resolver reads new keywords, CST `format` normalize pass + AST printer emit canonical, validation. FK relations only.
2. `through: Junction` explicit M:N (one-end declare + inverse inference, D4 unambiguous case).
3. `through: Junction.relationField` + `inverse:` disambiguation (D4 ambiguous case + 1:N back-relation; retires `name:`).
4. Implicit M:N — synthesise a model-less junction table + its migrations (D5 case 3).
5. Arrow-path `through: a -> J.b -> J.c -> T.d` — declare M:N on terminal models without junction relation fields.

Sequencing: 1 is the foundation; 2 → 3 sequential; 4 and 5 build on 2 (and 3 where ambiguity is possible) and parallelise.

## Alternatives considered

- **Hard break from `fields:`/`references:`** — drop the Prisma spelling entirely. **Rejected because:** forces every downstream PSL author to migrate at once; parse-both + canonical-emit is a strict superset at little cost.
- **Keep `@relation(name: "...")` for disambiguation.** **Rejected because:** the name is a free-floating token kept in sync across fields by convention; pointing at the relation field is direct and self-checking.
- **`via:` for the 1:N back-relation pointer.** **Rejected because:** homophone of `through`, and `through` wrongly implies an intermediary where a 1:N back-relation is simply the inverse of one FK. `inverse:` is exact (Doctrine/JPA `inversedBy`/`mappedBy` precedent).
- **Aggressive canonicalisation** (formatter drops inferable args / strips qualifiers). **Rejected (for now) because:** larger formatter with semantic schema-checks; deferred until there's evidence it's wanted.
- **`through:` required on both ends.** **Rejected because:** inferring the inverse honours omit-what's-inferable; explicit-both is reserved for genuine ambiguity.
- **"Both bare always synthesises" (literal).** **Rejected because:** it would silently ignore an authored junction model and break shipped slice-5 behaviour; D5's precedence synthesises only when no junction exists.

## Open questions

_Deferred to slice specs; each carries a working position so execution proceeds without blocking._

- **Implicit-M:N synthesis mechanics** (slice 4) — synthesised table/column naming (Prisma's `_AToB`/`A`/`B`, or our own convention) and migration/DDL threading. Working position: mirror Prisma's convention unless DDL threading argues otherwise.
- **Arrow-path grammar** (slice 5) — exact `a -> J.b -> J.c -> T.d` tokenisation + validation. Working position: a distinct lowering from implicit M:N (arrow-path keeps an authored junction *model* with scalar columns; implicit authors none).
- **Diagnostics** — wording for the new arguments, and the "you authored a junction but never referenced it" guard implied by D5's case (2)/(3) boundary.
- **`to:` value grammar** — accepts bare field / bracketed list; redundant `Model.` qualifier tolerated and preserved. Cross-model qualified paths are arrow-path territory, not slice 1.

## Accepted trade-offs

- Two **input** dialects exist permanently (legacy + canonical); only **output** is single-dialect.

## References

- Project spec: [`./spec.md`](./spec.md)
- Project plan: [`./plan.md`](./plan.md)
- Straw-man: `wip/mn-psl-changes.diff`
- Sibling project: `projects/sql-orm-many-to-many/` (runtime M:N; retains slice 7 / TML-2933, non-id unique junction targets)
- Primary surfaces: `packages/2-sql/2-authoring/contract-psl/src/psl-relation-resolution.ts`; `packages/2-sql/2-authoring/contract-ts/src/build-contract.ts`; `@prisma-next/psl-parser` (`src/format/`, generic attribute grammar); `@prisma-next/psl-printer` (AST printer for `contract infer`); CLI `format` command (`packages/1-framework/3-tooling/cli/src/commands/format.ts`).
