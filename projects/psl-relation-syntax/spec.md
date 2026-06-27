# PSL: Directional Relation Syntax

## Purpose

Make PSL relations legible and self-checking. Today a relation is declared with Prisma's non-directional `@relation(fields:, references:, name:)` — foreign keys named positionally, disambiguation carried by a free-floating string kept in sync across two fields by convention. This project replaces that with a directional, point-don't-name vocabulary (`from:` / `to:` / `through:` / `inverse:`) so a relation says what it does and disambiguates by referring to the field itself, not a string.

## At a glance

Backward-compatible: the legacy spelling stays valid **input**; the toolchain only ever **emits** the canonical form (`prisma-next format` and `contract infer` rewrite legacy → canonical in place).

```prisma
// Legacy (still parses; never re-emitted)
model Post {
  userId Uuid
  user   User  @relation(fields: [userId], references: [id])
  tags   Tag[]
}
model PostTag {
  postId Uuid
  tagId  Uuid
  post   Post @relation(fields: [postId], references: [id])
  tag    Tag  @relation(fields: [tagId], references: [id])
  @@id([postId, tagId])
}

// Canonical (what the toolchain emits)
model Post {
  userId Uuid
  user   User  @relation(from: userId)          // `to:` omitted ⇒ target @id
  tags   Tag[] @relation(through: PostTag)        // one end declares; inverse inferred
}
model PostTag {
  postId Uuid
  tagId  Uuid
  post   Post @relation(from: postId)
  tag    Tag  @relation(from: tagId)
  @@id([postId, tagId])
}
```

Disambiguation is by pointing, not naming: a 1:N back-relation with multiple candidates uses `inverse: <fkField>`; an ambiguous M:N (self-relation or multiple between the same models) declares `through: <Junction>.<relationField>` on both ends. `@relation(name:)` is retired from canonical output. The full design — decisions D1–D5, principles, rejected alternatives — lives in [`./design-notes.md`](./design-notes.md).

## Non-goals

- **The runtime M:N feature itself** — `include` / filter / nested write over junctions already shipped in the sibling project ([SQL ORM: Many-to-Many End to End](https://linear.app/prisma-company/project/sql-orm-many-to-many-end-to-end-c178df40ca3a)). This project changes how relations are *authored*, not how they execute.
- **Non-id, non-null unique junction targets** — sibling slice 7 / TML-2933.
- **Aggressive canonicalisation** — dropping inferable arguments, stripping redundant `Model.` qualifiers, or normalising bracket usage on `format`. Per D3 the formatter migrates the keyword token only; aggressive normalisation is a possible future, explicitly deferred.
- **TS-builder relation-authoring syntax** — `from`/`to`/`through`/`inverse` is a PSL attribute vocabulary; the TS contract builder is touched only where implicit-junction synthesis logic is genuinely shared.
- **Retiring legacy acceptance** — legacy `fields`/`references`/`name` parse forever (input-only); any removal is a separate future project.

## Place in the larger world

- **Sibling — `sql-orm-many-to-many` (runtime M:N).** This is its authoring-surface counterpart. The runtime consumes the **existing** contract `through` / relation shapes; this project changes how those shapes are authored, not the shapes themselves (the backward-compat invariant below makes that precise).
- **Primary surfaces.** `@prisma-next/psl-parser` (generic attribute grammar — accepts the new keywords with no grammar change; the lossless CST `format/` emitter); `@prisma-next/sql-contract-psl` `psl-relation-resolution.ts` (lowering); `@prisma-next/psl-printer` (AST printer used by `contract infer`); the CLI `format` command (`packages/1-framework/3-tooling/cli/src/commands/format.ts`); `@prisma-next/sql-contract-ts` `build-contract.ts` (shared implicit-junction synthesis / parity).
- **ADR.** The directional vocabulary, the retirement of `@relation(name:)`, and implicit-junction synthesis are architecturally durable. An ADR is committed as part of close-out (see Project DoD).

## Contract-impact

- **`from`/`to`/`through`/`inverse`: no change to the emitted contract shape.** These lower to the same relation / `through` shapes the sibling already emits. The cross-cutting invariant is that legacy and canonical spellings produce *byte-identical* contracts.
- **Implicit M:N (slice for D5 case 3): additive.** A bare-list M:N with no authored junction synthesises a model-less junction **table** plus its `N:M` + `through` relations into the emitted contract — content the user did not author, expressed through existing contract kinds. The synthesised junction must round-trip `validateContract`; `sql-orm-client` already consumes `through`, so no downstream contract-consumer change is required.

## Adapter-impact

- **postgres + sqlite:** the implicit-M:N synthesised junction emits `CREATE TABLE` DDL through the normal migration path, like any authored table. `from`/`to`/`through`/`inverse` are authoring-only and have no adapter impact.
- **mongo:** N/A — a junction table is a SQL-family concept.

## Cross-cutting requirements

- **Backward-compat invariant (D1).** Legacy (`fields`/`references`/`name`) and canonical (`from`/`to`/`through`/`inverse`) spellings lower to **byte-identical contracts**. Every slice that introduces canonical syntax proves the two forms are equivalent.
- **Single-dialect output (D1).** `format` and `contract infer` emit canonical only; a round-trip never yields legacy. Enforced by a grep gate plus round-trip tests.
- **Formatter idempotence.** `format(format(x)) == format(x)` for every supported form; comments and trivia on relation attributes are preserved (D3).
- **Runtime parity per the integration standard.** Every navigable-relation form (explicit M:N, disambiguated M:N, implicit M:N, arrow-path) carries an emitted fixture exercised end-to-end through the `sql-orm-client` ORM, following the sibling's integration-test standard — whole-row assertions, explicit `select`, ≥1 implicit selection — proving the new authoring drives the already-shipped runtime.
- **Green throughout.** Every merged slice keeps CI green on `main` with `pnpm build`, `pnpm lint:deps`, and `pnpm fixtures:check` clean.

## Transitional-shape constraints

- No slice removes legacy-spelling acceptance; the backward-compat invariant holds at every intermediate state.
- Demo and example schemas stay green across slices; if a slice migrates a demo's relations to canonical syntax, it re-emits in the same slice so `fixtures:check` stays clean.
- `@relation(name:)` retirement lands as "no longer *emitted*" before (or with) any slice that stops *honouring* a positional name on input — input acceptance is never dropped mid-project.

## Project Definition of Done

_Inherits the team-DoD floor ([`drive/calibration/dod.md`](../../drive/calibration/dod.md) — repo-wide gates, doc/migration, Linear close-out, manual-QA roll-up, ADR audit). Project-specific conditions on top:_

- [ ] Every relation form the legacy vocabulary could express is authorable in the canonical vocabulary, **plus** the M:N forms legacy PSL could not — explicit junction (`through:`), self / multiple-M:N disambiguation (`through: J.field`), 1:N back-relation disambiguation (`inverse:`), implicit M:N (bare-list synthesis), and arrow-path — each round-tripping `validateContract`.
- [ ] Legacy and canonical spellings lower to byte-identical contracts (the backward-compat invariant), proven per slice.
- [ ] `@relation(name:)` is absent from canonical output (parsed on input, never emitted) — grep gate + round-trip test.
- [ ] `prisma-next format` rewrites legacy → canonical in place, idempotently, preserving comments/trivia; `contract infer` emits canonical.
- [ ] Each M:N authoring form has runtime-parity coverage through the ORM per the integration standard.
- [ ] At least one demo is authored end-to-end in the canonical vocabulary (or an explicit, recorded rationale for deferring).
- [ ] An ADR for the directional vocabulary + `name:` retirement + implicit-junction synthesis is authored and linked from `docs/architecture docs/adrs/`.

## Open Questions

1. _Implicit-junction synthesised table + column naming (the implicit-M:N slice)._ Working position: mirror Prisma's `_AToB` / `A` / `B` convention unless migration/DDL threading argues for our own.
2. _Arrow-path exact grammar and validation (the arrow-path slice)._ Working position: a distinct lowering from implicit M:N (arrow-path keeps an authored junction *model* with scalar columns; implicit authors none); precise tokens settled at slice spec.
3. _End-to-end demo: migrate the PG demo's relations to canonical, or add a fresh example?_ Working position: migrate the PG demo (already PSL-authored) as the end-to-end proof, re-emitting in the same slice.
4. _`to:` accepting a qualified `Model.column` value._ Working position: tolerated and preserved verbatim (D3); true cross-model qualified paths belong to the arrow-path slice, not the FK foundation.

## References

- Linear Project: [PSL: Directional Relation Syntax](https://linear.app/prisma-company/project/psl-directional-relation-syntax-04e6440a8ee4); planning anchor [TML-2939](https://linear.app/prisma-company/issue/TML-2939).
- Design record: [`./design-notes.md`](./design-notes.md) (decisions D1–D5, rejected alternatives, deferred questions).
- Sibling project: `projects/sql-orm-many-to-many/` (`spec.md`, `plan.md`) — runtime M:N; retains slice 7 / TML-2933.
- Straw-man: `wip/mn-psl-changes.diff`.
- ADRs: to be authored at close-out (directional relation vocabulary).
