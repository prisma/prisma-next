# Slice 4: SQLite demo M:N examples — DONE

_Parent project: `projects/sql-orm-many-to-many/`. Linear: [TML-2790](https://linear.app/prisma-company/issue/TML-2790). Status: **complete** (branch `tml-2790-mn-demo-examples`)._

## At a glance

Demonstrate the M:N ORM API end-to-end in the **SQLite** demo (`examples/prisma-next-demo-sqlite`, TS-authored — the only demo that can author M:N today, since the PG demo emits from PSL). Worked reference for include / filter / nested-write through a junction.

## Chosen design (as shipped)

`Post ↔ Tag` (+ reverse `Tag.posts`) M:N via a **pure** `PostTag` junction (`postId`/`tagId`, composite PK, no payload), authored in `prisma/contract.ts` with `rel.manyToMany(() => Tag, { through: () => PostTag, from, to })`. Emitted contract carries `cardinality:'N:M'` + `through`. ORM client modules:

- `get-post-tags.ts` — `.include('tags', t => t.select('id','label')…)`.
- `get-posts-by-tag-filter.ts` — `.where(p => p.tags.some/none(t => t.label.eq(...)))` plus `.every(t => t.label.neq(...))`; the `every` demo includes posts with no tags by vacuous truth.
- `connect-post-tags.ts` / `disconnect-post-tags.ts` — `.update({ tags: t => t.connect/disconnect([{ id }]) })` + readback.
- `create-post-with-tags.ts` — `.create({ …, tags: t => t.create([{ label }]) })`.

Wired as 7 CLI commands in `src/main.ts`; seed adds tags + junction rows. Smoke-tested end-to-end (SQLite is offline-runnable).

## Scope

**In:** the SQLite demo only — contract, emit, ORM modules, CLI, seed. **Out:** the PG demo (PSL can't author M:N — slice 6, blocked by slice 5).

## Slice-specific done conditions

- [x] Emitted contract has `cardinality:'N:M'` + `through`; `emit:check` + typecheck clean.
- [x] include / `some`/`none`/`every` / connect / disconnect / create examples run end-to-end (smoke-tested via CLI).

## References

- Parent: `projects/sql-orm-many-to-many/spec.md`.
