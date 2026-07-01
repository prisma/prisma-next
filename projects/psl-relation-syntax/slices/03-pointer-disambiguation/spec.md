# Slice 3: pointer disambiguation — retire `@relation(name:)`

_Parent project: `projects/psl-relation-syntax/`. Linear: [TML-2942](https://linear.app/prisma-company/issue/TML-2942). Builds on slices 1–2. Design: `design-notes.md` decisions **D2**, **D4** (ambiguous case)._

## At a glance

Disambiguate relations by **pointing at the relation field**, not by a free-floating string:

- **Ambiguous M:N** (self-relation, or multiple M:N between the same pair of models): both ends declare `through: Junction.relationField` — the dotted form pins the junction FK leg.
- **1:N back-relation** with multiple candidates: `posts Post[] @relation(inverse: editor)` points at the owning FK field.
- **`@relation(name:)` is retired from canonical output** — the `contract infer` printer and canonical authoring emit the pointer forms; `name:` stays accepted as **legacy input** and is left untouched by `format` (per operator decision; auto-conversion is a deferred follow-up).

This is the largest core slice; its breadth is unified by one theme — _disambiguation by pointing_.

## Chosen design

1. **Member-access value grammar (psl-parser).** The PSL expression grammar carries only the head identifier of a dotted value (`Foo.bar` → `Foo`). Extend the argument-value grammar to parse a qualified `Identifier.Identifier` (and preserve both segments) so `through: Junction.relationField` round-trips. This unblocks S5's arrow-path and the deferred `to:` qualifier too. Foundation dispatch.
2. **`through: Junction.relationField` (resolver).** `ParsedRelationAttribute.through` becomes a `{ junction: string; field?: string }` (or equivalent) — bare model name from slice 2, plus the optional relation-field segment. In `findJunctionFkPairs`, when the candidate carries `through.field`, pin the **parent-side FK** to the junction relation field named (the junction FK whose declaring field is `field`), resolving the self-relation / multiple-M:N ambiguity that slice 2 deferred (it currently falls into `PSL_AMBIGUOUS_BACKRELATION_LIST`).
3. **`inverse:` (resolver).** Add `inverse` to the `@relation` allow-list; a bare relation-field name (no grammar dependency). In the 1:N back-relation pairing (where multiple FK-side relations between the same pair of models force the `PSL_AMBIGUOUS_*` / name-based path today), `inverse: <fkField>` pins the owning FK field. This is the directional replacement for `name:` on the back side.
4. **Retire `name:` from canonical output (printer).** `sql-schema-ir-to-psl-ast.ts` `buildRelationField` emits `name:` today for `relationName` disambiguation. Change it to emit the pointer form — `inverse:` on the back side of a disambiguated 1:N (and `through: J.field` where it infers an M:N needing it, if applicable). Wire a grep gate: no `@relation(name:)` in printer/canonical output. `name:` remains a parsed legacy input; the formatter (slice 1) leaves it untouched.
5. **Integration parity.** A self-referential M:N (e.g. `User.following`/`User.followers` via a `Follow` junction) authored with `through: Follow.follower`/`through: Follow.followee`, and a 1:N with two relations between the same models disambiguated with `inverse:`, exercised through the ORM per the project integration standard.

## Scope

**In:** member-access value grammar; `through: J.field` M:N disambiguation; `inverse:` 1:N disambiguation; printer emits pointer forms (retire `name:` from output) + grep gate; round-trip `validateContract`; integration parity (self-rel M:N + disambiguated 1:N).

**Out:** auto-converting a legacy `name:` schema to pointer form in `format` (deferred follow-up — operator decision #4); implicit synthesis (S4); arrow-path (S5); the `to: Model.col` qualifier (S5, now unblocked by this slice's grammar); the M:N runtime (sibling).

## Pre-investigated edge cases

| Edge case | Disposition |
|---|---|
| Self-referential M:N (two FKs from the junction to the same model) | the core `through: J.field` case — both ends pin their leg; this is what slice 2 deferred |
| `through: J.field` where `field` isn't a junction FK back to the candidate | actionable diagnostic (not silent) |
| `inverse:` naming a field that isn't an FK-side relation to the candidate | actionable diagnostic |
| legacy `@relation(name:)` schema | still parses; lowers as today; survives `format` unchanged (not auto-converted) |
| a relation needing no disambiguation that gratuitously specifies `inverse:`/`through: J.field` | accept (explicit-but-redundant), or a low-key diagnostic — decide at dispatch, lean accept |

## Slice-specific done conditions

- [ ] `through: Junction.relationField` parses (member-access grammar) and disambiguates a self-referential / multiple-between-same-models M:N — proven by a lowering test on a shape that is `PSL_AMBIGUOUS_BACKRELATION_LIST` without the qualifier.
- [ ] `inverse: <fkField>` disambiguates a 1:N back-relation with multiple candidates — lowering test on a shape that needs `name:` today.
- [ ] The `contract infer` printer / canonical output emits **no** `@relation(name:)` — grep gate; legacy `name:` still parses and survives `format`.
- [ ] Self-referential M:N (`through: J.field`) + disambiguated 1:N (`inverse:`) drive the ORM — integration (PGlite, project standard).

## References

- Project: `spec.md`, `design-notes.md` (D2, D4). Operator decisions in `wip/unattended-decisions.md` (#4 name-retirement, #5 keep-4/5).
- Surfaces: `psl-parser/src/parse.ts` (`parseArgValue`/`parseExpression`/`parseIdentifierExpr`; `parseQualifiedName` for Dot handling); `contract-psl/src/psl-relation-resolution.ts` (`findJunctionFkPairs`, the backrelation pairing + `PSL_AMBIGUOUS_*`), `interpreter.ts`; `sql-schema-ir-to-psl-ast.ts` (`buildRelationField` `name:` emission).
