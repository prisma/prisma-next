# Slice 2: `through: Junction` explicit M:N

_Parent project: `projects/psl-relation-syntax/`. Linear: [TML-2941](https://linear.app/prisma-company/issue/TML-2941). Builds on slice 1's `from`/`to` foundation. Design: `design-notes.md` decision **D4** (unambiguous case)._

## At a glance

A navigable list field may declare its junction explicitly: `tags Tag[] @relation(through: PostTag)`. The resolver recognises the M:N via the **named** junction and lowers it to the **existing** `N:M` + `through` contract shape (the one the sibling's runtime already consumes). Per D4 (unambiguous case), `through:` is declared on **one** end; the opposite bare list field (`posts Post[]`) resolves as the inferred inverse via the existing bare-list convention recognition. Disambiguation (`through: Junction.field`) and `inverse:` are slice 3; this slice is the unambiguous explicit-junction path.

## Chosen design

- **Parse `through:`** — add `through` to the `@relation` argument allow-list (alongside `from`/`to` from slice 1); `parseRelationAttribute` reads a bare model name (`through: PostTag`). `ParsedRelationAttribute` gains `through?: string` (the junction model name). The qualified `Junction.field` form is **slice 3** — for slice 2 `through:` is a bare model identifier only; a dotted value is out of scope here (and the member-access grammar is the S5/qualifier work).
- **Recognise via the named junction** — when a backrelation list field carries `through: M`, recognise the M:N using model `M` directly rather than (only) the convention scan: validate `M` is junction-shaped for this candidate — it declares an FK back to the candidate's model (parent side) and an FK to the target model (child side), its `@@id` columns are exactly those two FKs' columns (`idColumnsAreExactlyFkPair`), and the child FK references the target's full id (`childColumnsInTargetIdOrder`). Emit the same `N:M` + `through { table, parentColumns, childColumns, namespaceId }` descriptor the convention path emits.
- **Preserve the bare-list convention path (D5 case 2)** — a bare list with no `through:` still resolves via `findJunctionFkPairs`. So a one-end-declared M:N (`through:` on `Post.tags`, bare `Tag.posts`) resolves on both ends.
- **Emit:** `through:` has no legacy equivalent, so slice 1's formatter rename leaves it untouched (verify it survives `format`). `contract infer` does not synthesise navigable M:N, so the printer is unaffected.

## Coherence rationale (slice-INVEST · _Small_)

One outcome — "an explicitly-declared `through: Junction` authors a navigable M:N that lowers to the runtime's existing `through` shape." The recognition reuses the junction-shaped validation already in `psl-relation-resolution.ts`; the runtime is unchanged (sibling-owned). A reviewer holds it as "does an explicit `through:` recognise the same M:N the convention path does, and does it drive the existing ORM?"

## Scope

**In:** parse `through:` (bare model name); explicit-named-junction M:N recognition lowering to `N:M` + `through`; validation diagnostic when `through:` names a non-junction-shaped model; unit tests (explicit-`through:` and bare-list lower to the **same** M:N contract; the diagnostic); one runtime-parity integration fixture authored with `through:` exercised through the ORM `include` per the project integration standard; `fixtures:check`.

**Out:** `through: Junction.relationField` disambiguation + `inverse:` (S3); implicit synthesis (S4); arrow-path (S5); the M:N **runtime** itself (sibling — unchanged; this slice only authors into its existing contract shape); `@relation(name:)` (untouched until S3).

## Pre-investigated edge cases

| Edge case | Disposition |
|---|---|
| `through:` on one end, bare list on the other | both resolve — explicit via the named junction, bare via the convention scan (D4 inverse inference) |
| `through:` names a model that isn't junction-shaped (no FK to one side / `@@id` ≠ the two FKs) | actionable diagnostic (reuse the near-miss reasons: `id-not-fk-covering` / `target-fk-not-id`) — do not silently fall through |
| `through:` names a model whose child FK references a non-id unique | declines today (the `childColumnsInTargetIdOrder` full-id requirement) — that is the sibling's slice-7 / TML-2933 territory, **out of scope** |
| self-relation / two M:N between the same models with bare `through:` | ambiguous — **S3** (`through: Junction.field`); a bare `through:` here may still be ambiguous and should defer to S3's diagnostic, not silently pick |

## Slice-specific done conditions

- [ ] An M:N authored `tags Tag[] @relation(through: PostTag)` (one-end-declared, bare inverse) lowers to the same `N:M` + `through` contract as the equivalent bare-list form — proven by an equivalence unit test.
- [ ] `db.orm.<Model>.include(<m2n>)` over a **PSL-`through:`-authored** M:N returns the related rows — whole-row assertions, ≥1 implicit select (project integration standard). _Harness: PGlite only — the M:N integration suites have no SQLite adapter path (sibling-established); "PG + SQLite" reduces to PGlite here._
- [ ] `through:` naming a non-junction model produces an actionable diagnostic (regression test on a declined shape).

## References

- Project: `spec.md`, `design-notes.md` (D4, D5). Slice 1's `from`/`to` foundation is the base.
- Surfaces: `contract-psl/src/psl-relation-resolution.ts` (`parseRelationAttribute` allow-list + `findJunctionFkPairs` / `idColumnsAreExactlyFkPair` / `childColumnsInTargetIdOrder` recognition; `ModelBackrelationCandidate`). Sibling M:N runtime + the `mn-psl` integration fixture (`projects/sql-orm-many-to-many/`).
