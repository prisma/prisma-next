# PSL: Directional Relation Syntax

## Purpose

Make PSL relations legible and self-checking. Today a relation is declared with Prisma's non-directional `@relation(fields:, references:, name:)` — foreign keys named positionally, disambiguation carried by a free-floating string kept in sync across two fields by convention. This project replaces that with a directional, point-don't-name vocabulary (`from:` / `to:` / `through:` / `inverse:`) so a relation says what it does and disambiguates by referring to the field itself, not a string.

## At a glance

Clean break: the directional vocabulary is the only accepted `@relation` syntax. Legacy `fields:`/`references:` and `@relation(name:)` are rejected at parse time with a guiding diagnostic. A reusable downstream codemod is deferred (TML-2957); the repo's own schemas are migrated in-stack.

```prisma
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

Disambiguation is by pointing, not naming: a 1:N back-relation with multiple candidates uses `inverse: <fkField>`; an ambiguous M:N (self-relation or multiple between the same models) declares `through: <Junction>.<relationField>` on both ends. `@relation(name:)` is rejected at parse time. The full design — decisions D1–D5, principles, rejected alternatives — lives in [`./design-notes.md`](./design-notes.md).

## Non-goals

- **The runtime M:N feature itself** — `include` / filter / nested write over junctions already shipped in the sibling project ([SQL ORM: Many-to-Many End to End](https://linear.app/prisma-company/project/sql-orm-many-to-many-end-to-end-c178df40ca3a)). This project changes how relations are *authored*, not how they execute.
- **Non-id, non-null unique junction targets** — sibling slice 7 / TML-2933.
- **Automated downstream migration codemod** — a reusable tool that rewrites legacy `fields:`/`references:`/`name:` schemas to the canonical vocabulary. Deferred as TML-2957; the repo's own schemas are migrated manually in-stack.
- **TS-builder relation-authoring syntax** — `from`/`to`/`through`/`inverse` is a PSL attribute vocabulary; the TS contract builder is touched only where implicit-junction synthesis logic is genuinely shared.

## Place in the larger world

- **Sibling — `sql-orm-many-to-many` (runtime M:N).** This is its authoring-surface counterpart. The runtime consumes the **existing** contract `through` / relation shapes; this project changes how those shapes are authored, not the shapes themselves (the contract-shape invariant below makes that precise).
- **Primary surfaces.** `@prisma-next/psl-parser` (generic attribute grammar — accepts the new keywords with no grammar change; member-access value parsing for `through: J.field`); `@prisma-next/sql-contract-psl` `psl-relation-resolution.ts` (lowering); `@prisma-next/psl-printer` (AST printer used by `contract infer`); `@prisma-next/mongo-family` `psl-helpers.ts` (Mongo relation parsing); `@prisma-next/sql-contract-ts` `build-contract.ts` (shared implicit-junction synthesis / parity).
- **ADR.** The directional vocabulary, the retirement of `@relation(name:)`, and implicit-junction synthesis are architecturally durable. An ADR is committed as part of close-out (see Project DoD).

## Contract-impact

- **`from`/`to`/`through`/`inverse`: no change to the emitted contract shape.** These lower to the same relation / `through` shapes the sibling already emits. The cross-cutting invariant is that the new authoring syntax produces the same contracts the legacy vocabulary would have — the repo migration proves this byte-identically.
- **Implicit M:N (slice for D5 case 3): additive.** A bare-list M:N with no authored junction synthesises a model-less junction **table** plus its `N:M` + `through` relations into the emitted contract — content the user did not author, expressed through existing contract kinds. The synthesised junction must round-trip `validateContract`; `sql-orm-client` already consumes `through`, so no downstream contract-consumer change is required.

## Adapter-impact

- **postgres + sqlite:** the implicit-M:N synthesised junction emits `CREATE TABLE` DDL through the normal migration path, like any authored table. `from`/`to`/`through`/`inverse` are authoring-only and have no adapter impact.
- **mongo:** `from`/`to` FK relations apply to Mongo as well; implicit M:N junction is a SQL-family concept (no junction table in Mongo).

## Cross-cutting requirements

- **Contract-shape invariant (D1).** The directional vocabulary lowers to the same relation / `through` shapes the legacy vocabulary would have produced. The repo migration (legacy → `from`/`to`/`through`/`inverse`) is proven byte-identical: `fixtures:check` shows zero contract drift across all migrated schemas.
- **Legacy rejection (D1 clean break).** `@relation(fields:, references:)` and `@relation(name:)` are rejected at parse time with a guiding diagnostic (`PSL_LEGACY_FIELDS_REFERENCES` / `PSL_LEGACY_NAME`) directing authors to the replacement. Both the SQL and Mongo family resolvers enforce this.
- **Single-dialect output.** `contract infer` emits the canonical vocabulary only; a grep gate asserts no legacy keys in printer output.
- **Runtime parity per the integration standard.** Every navigable-relation form (explicit M:N, disambiguated M:N, implicit M:N, arrow-path) carries an emitted fixture exercised end-to-end through the `sql-orm-client` ORM, following the sibling's integration-test standard — whole-row assertions, explicit `select`, ≥1 implicit selection — proving the new authoring drives the already-shipped runtime.
- **Green throughout.** Every merged slice keeps CI green on `main` with `pnpm build`, `pnpm lint:deps`, and `pnpm fixtures:check` clean.

## Transitional-shape constraints

- Legacy `@relation(fields:, references:)` and `@relation(name:)` are rejected at parse time; the repo's own schemas are migrated to `from`/`to`/`through`/`inverse` so `fixtures:check` stays clean throughout.
- Demo and example schemas are migrated to the canonical vocabulary within the stack; migration-history snapshots re-emit byte-identically (the migration hash is computed over `migration.json`/`ops.json`, not the `.prisma` source).

## Project Definition of Done

_Inherits the team-DoD floor ([`drive/calibration/dod.md`](../../drive/calibration/dod.md) — repo-wide gates, doc/migration, Linear close-out, manual-QA roll-up, ADR audit). Project-specific conditions on top:_

- [ ] Every relation form the legacy vocabulary could express is authorable in the directional vocabulary, **plus** the M:N forms legacy PSL could not — explicit junction (`through:`), self / multiple-M:N disambiguation (`through: J.field`), 1:N back-relation disambiguation (`inverse:`), implicit M:N (bare-list synthesis), and arrow-path — each round-tripping `validateContract`.
- [ ] The repo migration from legacy to directional syntax is byte-identical: `fixtures:check` shows zero contract drift across all migrated schemas (SQL and Mongo families).
- [ ] `@relation(fields:, references:)` and `@relation(name:)` are rejected at parse time in both SQL and Mongo family resolvers, with guiding diagnostics.
- [ ] `@relation(name:)` is absent from `contract infer` printer output — grep gate.
- [ ] `contract infer` emits the directional vocabulary only.
- [ ] Each M:N authoring form has runtime-parity coverage through the ORM per the integration standard.
- [ ] At least one demo is authored end-to-end in the canonical vocabulary (or an explicit, recorded rationale for deferring).
- [ ] An ADR for the directional vocabulary + `name:` retirement + implicit-junction synthesis is authored and linked from `docs/architecture docs/adrs/`.

## Open Questions

1. _Implicit-junction synthesised table + column naming (the implicit-M:N slice)._ Working position: mirror Prisma's `_AToB` / `A` / `B` convention unless migration/DDL threading argues for our own.
2. _Arrow-path exact grammar and validation (the arrow-path slice)._ Working position: a distinct lowering from implicit M:N (arrow-path keeps an authored junction *model* with scalar columns; implicit authors none); precise tokens settled at slice spec.
3. _End-to-end demo: migrate the PG demo's relations to canonical, or add a fresh example?_ Working position: migrate the PG demo (already PSL-authored) as the end-to-end proof, re-emitting in the same slice.
4. _`to:` accepting a qualified `Model.column` value._ Resolved: the member-access value grammar landed in slice 3, so `to: Post.id` works (`to: Post.id` ≡ `to: id`). Cross-model qualified paths belong to the arrow-path slice.

## References

- Linear Project: [PSL: Directional Relation Syntax](https://linear.app/prisma-company/project/psl-directional-relation-syntax-04e6440a8ee4); planning anchor [TML-2939](https://linear.app/prisma-company/issue/TML-2939).
- Design record: [`./design-notes.md`](./design-notes.md) (decisions D1–D5, rejected alternatives, deferred questions).
- Sibling project: `projects/sql-orm-many-to-many/` (`spec.md`, `plan.md`) — runtime M:N; retains slice 7 / TML-2933.
- Straw-man: `wip/mn-psl-changes.diff`.
- ADRs: to be authored at close-out (directional relation vocabulary).
