# @prisma-next/sql-kysely-lane

The **Prisma Next Kysely lane** lets you write low-level SQL using the **Kysely query DSL**, then have it interpreted and executed by the **Prisma Next runtime**.

This is the “drop down a level” API you use when the high-level **SQL ORM client** isn’t a good fit—e.g. you need to:

- performance-tune a query
- use a SQL feature the ORM client doesn’t expose yet
- express a shape that’s awkward at the ORM layer

For high-level queries, use `@prisma-next/sql-orm-client`.

Developing this package? See [`DEVELOPING.md`](./DEVELOPING.md).

## How it works (in one minute)

You:

1. write a query in Kysely
2. build a Prisma Next plan from that query
3. execute the plan via runtime

## Examples

### Example: select users

```ts
const kysely = db.kysely;

const query = kysely
  .selectFrom('user')
  .select(['id', 'email', 'createdAt'])
  .limit(10);

const rows = await runtime.execute(kysely.build(query));
```

### Example: insert + return one row

```ts
import { firstOrNull } from './kysely/result-utils';

const kysely = db.kysely;

const query = kysely
  .insertInto('user')
  .values({
    id: 'user_001',
    email: 'alice@example.com',
    kind: 'user',
    createdAt: new Date().toISOString(),
  })
  .returning(['id', 'email']);

const inserted = await firstOrNull(runtime.execute(kysely.build(query)));
```

## Links

- [Query Lanes](/docs/architecture%20docs/subsystems/3.%20Query%20Lanes.md)
- [ADR 160 - Kysely lane emits PN SQL AST](/docs/architecture%20docs/adrs/ADR%20160%20-%20Kysely%20lane%20emits%20PN%20SQL%20AST.md)
