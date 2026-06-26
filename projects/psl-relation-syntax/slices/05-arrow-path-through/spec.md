# Slice 5: arrow-path `through:`

_Parent project: `projects/psl-relation-syntax/`. Linear: [TML-2944](https://linear.app/prisma-company/issue/TML-2944). Builds on slice 2's `through` lowering + slice 3's member-access grammar. Design: `design-notes.md` (arrow-path open question); operator decisions #5 (kept in-project), #9 (value form)._

## At a glance

The arrow-path declares an M:N **on the terminal models** over a junction model that carries scalar columns + `@@id` but **no relation fields** — the path names the join columns directly:

```prisma
model Post { id Uuid @id; tags Tag[] @relation(through: id -> PostTag.postId -> PostTag.tagId -> Tag.id) }
model Tag  { id Uuid @id; posts Post[] @relation(through: id -> PostTag.tagId -> PostTag.postId -> Post.id) }
model PostTag { postId Uuid; tagId Uuid; @@id([postId, tagId]) }   // no `post`/`tag` relation fields
```

Path shape: `<localKey> -> <Junction.nearCol> -> <Junction.farCol> -> <targetKey>`. The resolver builds the `through` descriptor straight from the named columns, bypassing the relation-field-based junction recognition (slice 2) — which can't fire here because the junction has no relation fields.

## Chosen design

- **Value form (decision #9, M1's call):** prefer the unquoted `through: a -> J.b -> J.c -> T.d` if a clean `->` grammar fits the attribute-value parser; fall back to a **quoted string** `through: "a -> J.b -> J.c -> T.d"` (resolver splits on `->`/`.`) if not. Functionality identical; M1 reports which it used.
- **Recognition (resolver, column-based):** parse the 4-segment path. Validate: segment 1 = a local `@id`/key column on the declaring model; segments 2,3 = two distinct columns on the **same** junction model (the near + far FK columns); segment 4 = a key column on the target model. Build `through { table: <junction>, parentColumns: [<localKey>], childColumns: [<targetKey>]-mapped-via-far-col, targetColumns, namespaceId }` — i.e. the parent walks `declaring.localKey → junction.nearCol`, the child walks `junction.farCol → target.targetKey`. Reuse the slice-2 `through`-descriptor machinery for the node shape; the junction is a declared model (so `buildThroughDescriptor`'s model requirement holds).
- **Both ends** carry their own arrow-path (mirror-imaged near/far columns), per D4's both-ends rule when there's no single owning side (the junction has no relation fields to infer an inverse from). (If one-end-declare + inferred inverse proves natural, accept it — but both-ends is the safe default here.)
- **Diagnostics:** malformed path (not 4 segments / bad arrows); a named column that doesn't exist on its model; the two junction columns not on the same model; the junction not a declared model.

## Scope

**In:** the arrow-path value parse (form per #9); column-based `through` recognition + lowering; validation/diagnostics; round-trip `validateContract`; runtime `include` parity (PGlite). 

**Out:** generalising the path to >1 hop or non-junction intermediaries; inferring the arrow-path from a bare list (that's implicit M:N, S4); the `to:` qualifier (already live via S3·M1 grammar); changing slices 2–4.

## Pre-investigated edge cases

| Edge case | Disposition |
|---|---|
| Junction has scalar cols + `@@id` but no relation fields | the core case — column-based recognition (slice 2's relation-field path can't fire) |
| Junction also has relation fields | the arrow-path still works (column-based); slice 2's `through: Junction` is the alternative — both valid |
| Path column doesn't exist on its named model | actionable diagnostic |
| The two junction columns are on different models | diagnostic (a junction is one model) |
| Self-referential arrow-path M:N | the near/far columns disambiguate (no relation-field ambiguity) — should work; test it |

## Slice-specific done conditions

- [ ] An M:N authored with the arrow-path over a relation-field-less junction lowers to `cardinality:'N:M'` + a `through` descriptor with the correct parent/child columns — `toEqual` on `Contract` + `validateSqlContractFully`.
- [ ] `db.orm.<Model>.include(<m2n>)` over an arrow-path M:N returns the related rows — integration (PGlite, project standard).
- [ ] Malformed-path / missing-column / cross-model-junction-columns diagnostics fire (regression tests).

## References

- Project: `spec.md`, `design-notes.md`; `wip/unattended-decisions.md` #5, #9.
- Surfaces: `psl-parser/src/parse.ts` (arrow grammar, if unquoted); `contract-psl/src/psl-relation-resolution.ts` + `interpreter.ts` (column-based `through` recognition); the slice-2 `through`-descriptor machinery; the sibling M:N runtime (unchanged).
