# Design notes: psl-relation-syntax

> Synthesized design document for `psl-relation-syntax`. Read this if you want to understand **what the project's design is**, **what principles it serves**, and **what alternatives were considered and rejected**. This document is not a chronological log of decisions — it captures the settled design, standing independently of the discussions that produced it.
>
> Owned by the Orchestrator. Authored directly. **Status: grammar settled (D1–D5) via `drive-discussion`, 2026-06-24; D1 reversed to a clean break on 2026-06-26 (operator decision — legacy input acceptance and the `format` rewrite removed). Slice-level mechanics deferred to slice specs.**

## Principles this design serves

- **Directionality reads naturally** — a relation is "from these local fields to that referenced key"; the vocabulary says so.
- **Omit what can be inferred** — single fields need no brackets; a referenced `@id` needs no explicit `to:`; an unambiguous junction is named on one end only.
- **Clean break** — the directional vocabulary is the only accepted syntax; legacy `fields:`/`references:`/`@relation(name:)` are rejected with a guiding diagnostic. A reusable codemod for downstream users is deferred (TML-2957).
- **Disambiguate by pointing, not by naming** — replace the free-floating `@relation(name: "...")` string with a direct reference to the relation field.
- **Explicit over magic** — junction synthesis fires only when there is genuinely no junction to find; an authored junction is never silently ignored.

## The model

Canonical vocabulary on `@relation`:

- `from:` — local FK field(s). Bare for a single field (`from: userId`); bracketed for composites (`from: [followerId, ...]`), brackets required when composite.
- `to:` — the referenced key. Omitted ⇒ infer the target's `@id`. Bare single field or bracketed list. A redundant `Model.` qualifier (`to: Post.id`) is tolerated and preserved verbatim; true cross-model qualified paths belong to the arrow-path slice.
- `through:` — the junction for the navigable M:N side. Named on **one** end when unambiguous (the inverse list field is inferred by type-match); on **both** ends with a relation-field path (`through: Follow.follower`) only to disambiguate self-relations or multiple M:N between the same pair of models.
- `inverse:` — the 1:N back-relation's pointer at the inverse FK field, used only to disambiguate when multiple relations link the same pair of models (`posts Post[] @relation(inverse: editor)`).

### Decisions

- **D1 — Clean break: `from`/`to`/`through`/`inverse` only; legacy rejected.** The directional vocabulary is the sole accepted `@relation` syntax. Legacy `fields:`/`references:` and `@relation(name:)` are rejected at parse time with a guiding diagnostic (`PSL_LEGACY_FIELDS_REFERENCES` / `PSL_LEGACY_NAME`) that directs authors to the replacement. The `format` command no longer rewrites relation keywords — it was removed when legacy acceptance was dropped, since `format` cannot operate on now-invalid syntax. The `contract infer` AST printer (`@prisma-next/psl-printer`) renders the canonical spelling. The repo's own schemas (SQL and Mongo families) are migrated in-stack; a reusable downstream codemod is deferred (TML-2957). *(Reverses the original D1, which kept legacy as input-only with a `format`-based auto-rewrite. Operator decision, 2026-06-26.)*
- **D2 — Retire `@relation(name:)` entirely.** Disambiguation is by pointing: `from`/`to` (FK declaration), `through:` (M:N junction side), `inverse:` (1:N back side). One mechanism per case; no string survivor across cardinalities. Legacy `name:` is rejected at parse time (per D1 clean break), not merely dropped from output.
- **D3 — (Removed.)** The conservative `format` canonicalisation pass (keyword migration only) was built in S1·M2 and then removed when D1 was reversed — `format` no longer rewrites relations. The CST formatter still exists for layout normalisation; it simply has no relation-keyword rewrite.
- **D4 — `through:` on one end; infer the inverse.** Unambiguous M:N: one navigable end declares `through: Junction`, the other's inverse list is inferred. Ambiguous (self-relation / multiple M:N between the same models): both ends declare and disambiguate via `through: Junction.relationField`.
- **D5 — Bare-list precedence.** Resolving a bare list (`Tag[]`): (1) other end has `through:` → this is its inferred inverse; (2) both ends bare **and** a junction model links them → recognise that authored junction (preserves shipped slice-5 behaviour); (3) both ends bare **and** no junction model → synthesise a model-less junction table (implicit M:N).

### Provisional slice slate

1. `from`/`to` FK foundation: reject legacy `fields:`/`references:` at parse time, resolver reads `from`/`to` with `to:` inference, AST printer emits canonical, repo-wide migration to `from`/`to`. FK relations only.
2. `through: Junction` explicit M:N (one-end declare + inverse inference, D4 unambiguous case).
3. `through: Junction.relationField` + `inverse:` disambiguation (D4 ambiguous case + 1:N back-relation; retires `name:`).
4. Implicit M:N — synthesise a model-less junction table + its migrations (D5 case 3).
5. Arrow-path `through: a -> J.b -> J.c -> T.d` — declare M:N on terminal models without junction relation fields.

Sequencing: 1 is the foundation; 2 → 3 sequential; 4 and 5 build on 2 (and 3 where ambiguity is possible) and parallelise.

## Alternatives considered

- **Parse-both + canonical-emit (the original D1).** Legacy `fields:`/`references:`/`name:` would keep parsing as input-only, with `format` rewriting to canonical and the printer emitting canonical. **Rejected because:** the operator preferred a clean break — the prototype is pre-1.0, breaking changes are acceptable, and carrying a legacy dialect plus a `format`-based auto-migration that can't operate on now-invalid syntax adds surface area for little benefit. *(Reversal decision, 2026-06-26.)*
- **Keep `@relation(name: "...")` for disambiguation.** **Rejected because:** the name is a free-floating token kept in sync across fields by convention; pointing at the relation field is direct and self-checking.
- **`via:` for the 1:N back-relation pointer.** **Rejected because:** homophone of `through`, and `through` wrongly implies an intermediary where a 1:N back-relation is simply the inverse of one FK. `inverse:` is exact (Doctrine/JPA `inversedBy`/`mappedBy` precedent).
- **Aggressive canonicalisation** (formatter drops inferable args / strips qualifiers). **Rejected because:** the `format` rewrite was removed entirely when D1 was reversed, so there is no canonicalisation pass to make aggressive. The formatter does layout only.
- **`through:` required on both ends.** **Rejected because:** inferring the inverse honours omit-what's-inferable; explicit-both is reserved for genuine ambiguity.
- **"Both bare always synthesises" (literal).** **Rejected because:** it would silently ignore an authored junction model and break shipped slice-5 behaviour; D5's precedence synthesises only when no junction exists.

## Open questions

_Deferred to slice specs; each carries a working position so execution proceeds without blocking._

- **Implicit-M:N synthesis mechanics** (slice 4) — synthesised table/column naming (Prisma's `_AToB`/`A`/`B`, or our own convention) and migration/DDL threading. Working position: mirror Prisma's convention unless DDL threading argues otherwise.
- **Arrow-path grammar** (slice 5) — exact `a -> J.b -> J.c -> T.d` tokenisation + validation. Working position: a distinct lowering from implicit M:N (arrow-path keeps an authored junction *model* with scalar columns; implicit authors none).
- **Diagnostics** — wording for the new arguments, and the "you authored a junction but never referenced it" guard implied by D5's case (2)/(3) boundary.
- **`to:` value grammar** — accepts bare field / bracketed list; a redundant `Model.` qualifier (`to: Post.id`) works via the member-access value grammar landed in slice 3. Cross-model qualified paths are arrow-path territory.

## Accepted trade-offs

- **Clean break migration cost.** Downstream PSL authors with legacy schemas must migrate manually (a codemod is deferred as TML-2957). The repo's own ~40 legacy sites are migrated in-stack, byte-identically (the emitted contracts are unchanged — only the PSL spelling moves).
- **The `format` command no longer rewrites relation keywords.** It still normalises layout (indent, newlines) but does not touch `@relation` argument names. Legacy syntax is rejected at parse time, so there is nothing to canonicalise.

## References

- Project spec: [`./spec.md`](./spec.md)
- Project plan: [`./plan.md`](./plan.md)
- Straw-man: `wip/mn-psl-changes.diff`
- Sibling project: `projects/sql-orm-many-to-many/` (runtime M:N; retains slice 7 / TML-2933, non-id unique junction targets)
- Primary surfaces: `packages/2-sql/2-authoring/contract-psl/src/psl-relation-resolution.ts`; `packages/2-sql/2-authoring/contract-ts/src/build-contract.ts`; `@prisma-next/psl-parser` (generic attribute grammar; member-access value parsing); `@prisma-next/psl-printer` (AST printer for `contract infer`); `packages/2-mongo/2-authoring/mongo-family/src/psl-helpers.ts` (Mongo relation parsing).
- Deferred codemod: **TML-2957** (automated legacy → `from`/`to`/`through`/`inverse` migration for downstream users).
