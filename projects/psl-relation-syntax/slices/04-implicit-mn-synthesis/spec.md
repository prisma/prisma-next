# Slice 4: implicit M:N — synthesise a model-less junction

_Parent project: `projects/psl-relation-syntax/`. Linear: [TML-2943](https://linear.app/prisma-company/issue/TML-2943). Builds on slice 2's `through:` lowering. Design: `design-notes.md` decision **D5** (case 3); operator decisions #5 (kept in-project), #7 (naming)._

## At a glance

When both navigable list ends are **bare** (no `through:`) **and no junction model links them**, the framework **synthesises** a model-less junction table and lowers the relation to `cardinality:'N:M'` + a `through` descriptor over that synthesised table — Prisma's "implicit many-to-many." The table is created by the migration system (postgres + sqlite) and walked by the ORM, exactly like an authored junction.

```prisma
model Post { id Uuid @id @default(uuid()); tags Tag[]  }
model Tag  { id Uuid @id @default(uuid()); posts Post[] }
// no junction model → framework synthesises `_PostToTag(A, B)` and an N:M through over it
```

Per D5, the precedence is preserved: `through:` on one end → use the named junction; both bare **and** a junction model exists → recognise it (slice-5 behaviour, slices 2's path); both bare **and no** junction → **synthesise** (this slice).

## Chosen design

- **Detection (resolver).** In the bare-list M:N path (`contract-psl` `findJunctionFkPairs` / the backrelation resolution), when both ends are bare and no junction model is found for the pair, branch to **synthesis** instead of the orphaned-backrelation diagnostic. The two terminal models must each have a single-column (or composite) `@id` to reference.
- **Synthesis (lowering).** Inject a storage table into the contract IR: name `_<A>To<B>` (terminal storage names, alphabetically ordered — decision #7), columns `A` (FK → first model's id) and `B` (FK → second model's id), composite identity `(A, B)`, the FK types matched to the referenced id columns. Emit the `N:M` + `through { table, parentColumns, childColumns, targetColumns, namespaceId }` descriptor over it on **both** navigable ends. The contract is **additive** (a table with no PSL model).
- **Migration/DDL.** The synthesised table is a normal contract storage table, so the migration system should create it (postgres + sqlite `CREATE TABLE` + the composite PK + the two FKs) **without special-casing** — confirm this; if the migration pipeline rejects a model-less table or needs threading, that is the slice's real work (and a feasibility signal).
- **Runtime.** The `through` descriptor is the same shape the sibling runtime already consumes — the ORM `include` walks the synthesised junction unchanged.

## Feasibility halt (front-loaded)

This slice injects a table the user never authored into the contract IR and the migration pipeline. **S4·M1 must first confirm the contract IR + migration can cleanly accept a synthesised (model-less) storage table.** If they cannot within slice scope (e.g. the IR assumes every storage table has an authoring model, or the migration keys off the model set), **HALT and surface** — the slice may need re-scoping or its own design pass, and that is a load-bearing finding, not something to force.

## Scope

**In:** detection of the synthesise case (both bare, no junction model); synthesis of the `_AToB` junction table + `N:M`/`through` into the contract; migration `CREATE TABLE` for it (postgres + sqlite); runtime `include` parity; round-trip `validateContract`; `fixtures:check`.

**Out:** the explicit `through:` paths (slices 2–3); arrow-path (S5); a synthesised-junction naming **override** / `@@map` on the implicit junction (follow-up if wanted); implicit M:N **writes** beyond what the sibling runtime already supports; nullable/non-`@id` target keys (sibling slice 7 territory).

## Pre-investigated edge cases

| Edge case | Disposition |
|---|---|
| Both bare **and** a junction model exists | recognise it (D5 case 2 — slice 2's path), do **not** synthesise — preserve slice-5 behaviour |
| `through:` on one end | use the named junction (slice 2), not synthesis |
| terminal model lacks an `@id` | cannot synthesise an FK target → actionable diagnostic |
| two implicit M:N between the same pair of models | ambiguous for a synthesised name → diagnostic (explicit junction or `through:` required); do not silently collide table names |
| name collision: a real table already named `_AToB` | diagnostic, don't clobber |

## Slice-specific done conditions

- [ ] An implicit M:N (both ends bare, no junction model) emits a contract carrying the synthesised `_<A>To<B>` table + `N:M`/`through` on both ends, round-tripping `validateContract`.
- [ ] The synthesised table is created by `migrate` (postgres + sqlite) — DDL/migration test.
- [ ] `db.orm.<Model>.include(<m2n>)` over an implicit M:N returns the related rows — integration (PGlite, project standard).
- [ ] D5 precedence intact: both-bare-with-junction-model still recognises (does not synthesise); `through:` still uses the named junction.

## References

- Project: `spec.md`, `design-notes.md` (D5 case 3); `wip/unattended-decisions.md` #5, #7.
- Surfaces: `contract-psl/src/psl-relation-resolution.ts` + `interpreter.ts` (detection + synthesis injection); the contract storage-table IR; the migration/DDL pipeline (postgres + sqlite); the sibling M:N runtime (unchanged).
