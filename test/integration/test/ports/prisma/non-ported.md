# Non-ported — prisma/prisma

One entry per in-scope source test that cannot be faithfully expressed against prisma-next. Format:

`` - `<source file>` › `<test name>` — <what it verifies> — <specific reason it cannot be ported> ``

No grouped or generalized entries: one line per test.

<!-- entries appended per batch -->

<!-- batch: default-selection / create-default-date / atomic-increment-decrement / blog-update -->
- `packages/client/tests/functional/default-selection/tests.ts` › `includes lists` — verifies that a `String[]` list field is included in the default selection (postgres) — `String[]` array column type is unsupported by the prisma-next TS contract builder; no list/array field DSL exists
- `packages/client/tests/functional/default-selection/tests.ts` › `includes enum lists` — verifies that an `Enum[]` list field is included in the default selection (postgres) — `Enum[]` array column type is unsupported by the prisma-next TS contract builder; no list/array field DSL exists
- `packages/client/tests/functional/default-selection/tests.ts` › `includes composites` — verifies that a MongoDB composite type field is included in the default selection — MongoDB only; prisma-next has no MongoDB SQL ORM target
- `packages/client/tests/functional/0-legacy-ports/atomic-increment-decrement/tests.ts` › `atomic increment` — verifies `update({ credit: { increment: 1.5 }, age: { increment: 1 } })` atomically increments float and int columns — prisma-next ORM `update()` accepts `Partial<DefaultModelRow>` only; no atomic arithmetic update operation exists in the public API
- `packages/client/tests/functional/0-legacy-ports/atomic-increment-decrement/tests.ts` › `atomic decrement` — verifies `update({ credit: { decrement: 1.5 }, age: { decrement: 1 } })` atomically decrements float and int columns — prisma-next ORM `update()` accepts `Partial<DefaultModelRow>` only; no atomic arithmetic update operation exists in the public API
- `packages/client/tests/functional/0-legacy-ports/atomic-increment-decrement/tests.ts` › `atomic increment with negative value` — verifies `update({ credit: { increment: -1.5 }, age: { increment: -1 } })` with negative delta — prisma-next ORM `update()` accepts `Partial<DefaultModelRow>` only; no atomic arithmetic update operation exists in the public API
- `packages/client/tests/functional/0-legacy-ports/atomic-increment-decrement/tests.ts` › `atomic decrement with negative` — verifies `update({ credit: { decrement: -1.5 }, age: { decrement: -1 } })` with negative delta — prisma-next ORM `update()` accepts `Partial<DefaultModelRow>` only; no atomic arithmetic update operation exists in the public API
- `packages/client/tests/functional/blog-update/tests.ts` › `should create a user with posts and a profile and update itself and nested connections setting fields to null` — verifies a nested update with `profile: { update: { ... } }` and `posts: { updateMany: { data, where } }` and nullable field resets — prisma-next ORM `update()` supports only `create`/`connect`/`disconnect` on relations; nested `update` and `updateMany` relation operations are not implemented
