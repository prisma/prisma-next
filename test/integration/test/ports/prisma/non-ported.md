# Non-ported — prisma/prisma

One entry per in-scope source test that cannot be faithfully expressed against prisma-next. Format:

`` - `<source file>` › `<test name>` — <what it verifies> — <specific reason it cannot be ported> ``

No grouped or generalized entries: one line per test.

<!-- entries appended per batch -->

- `packages/client/tests/functional/enums/tests.ts` › `fails at runtime when an invalid entry is entered manually in SQLite` — SQLite-only path inserting an invalid enum value via `$executeRaw` and asserting a read-time error — no ORM raw-injection surface in prisma-next; enum validity is enforced at the postgres DB level, not through a raw-insert-then-read path.
- `packages/client/tests/functional/enum-array/tests.ts` › `can retrieve data with an enum array with a raw query and a custom parser` — driver-adapter-specific `$queryRaw` with a `PrismaPg` `userDefinedTypeParser` custom OID parser — no equivalent raw OID-parser hook in the prisma-next postgres driver public API.
- `packages/client/tests/functional/blog-update/tests.ts` › `should create a user with posts and a profile and update itself and nested connections setting fields to null` — single `update()` with nested `profile: { update: {...} }` and `posts: { updateMany: {...} }` — the prisma-next ORM relation mutator exposes only `create`/`connect`/`disconnect`; there is no nested `update` or `updateMany` on relations.
- `packages/client/tests/functional/0-legacy-ports/atomic-increment-decrement/tests.ts` › `atomic increment` — `update({ data: { credit: { increment: 1.5 }, age: { increment: 1 } } })` — the ORM `MutationUpdateInput` is `Partial<DefaultModelRow>` (plain scalar values); there are no arithmetic SET operators (`col = col + N`) in the ORM API or the SQL AST.
- `packages/client/tests/functional/0-legacy-ports/atomic-increment-decrement/tests.ts` › `atomic decrement` — decrement operator on `update()` — same gap: no arithmetic SET expressions in the ORM/SQL AST.
- `packages/client/tests/functional/0-legacy-ports/atomic-increment-decrement/tests.ts` › `atomic increment with negative value` — increment by a negative value on `update()` — same gap: no arithmetic SET expressions in the ORM/SQL AST.
- `packages/client/tests/functional/0-legacy-ports/atomic-increment-decrement/tests.ts` › `atomic decrement with negative` — decrement by a negative value on `update()` — same gap: no arithmetic SET expressions in the ORM/SQL AST.
