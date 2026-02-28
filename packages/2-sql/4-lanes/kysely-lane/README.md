# @prisma-next/sql-kysely-lane

Build-only Kysely lane for authoring Prisma Next SQL plans and lane-shaped filter interop payloads.

## Responsibilities

- Transform Kysely operation trees into Prisma Next SQL AST.
- Assemble `SqlQueryPlan<Row>` with lane metadata (`refs`, `paramDescriptors`, annotations).
- Expose build-only Kysely lane surface (`build(query)`, `whereExpr(query)`, `redactedSql`) used by composition roots.
- Enforce deterministic execution backstop on the lane-owned Kysely dialect/driver.
- Keep SQL redacted when compilation text is reachable from build-only surfaces.

For high-level query composition, use `@prisma-next/sql-orm-client`.

Developing this package? See [`DEVELOPING.md`](./DEVELOPING.md).

## Dependencies

- `kysely` for query authoring types and build-only dialect plumbing.
- `@prisma-next/sql-contract` for contract types.
- `@prisma-next/sql-relational-core` for AST and plan model types.
- `@prisma-next/contract` for descriptor/refs metadata types.
- `@prisma-next/utils` for shared helpers.

## Architecture

```mermaid
flowchart LR
  App[Caller] --> PostgresRoot[@prisma-next/postgres]
  PostgresRoot --> LaneClient[createKyselyLane]
  LaneClient --> QueryAuthoring[Kysely authoring methods]
  QueryAuthoring --> BuildPlan[build(query)]
  QueryAuthoring --> BuildWhere[whereExpr(query)]
  BuildPlan --> Transform[transformKyselyToPnAst]
  Transform --> Plan[SqlQueryPlan]
  BuildWhere --> ToWhereExpr[ToWhereExpr payload]
  Plan --> Runtime[@prisma-next/sql-runtime execute]
  ToWhereExpr --> Orm[@prisma-next/sql-orm-client where]
```

## Examples

```ts
const kysely = db.kysely;
const query = kysely.selectFrom('user').select(['id', 'email']).limit(10);
const rows = await runtime.execute(kysely.build(query)).toArray();
```

```ts
const filter = db.kysely.whereExpr(
  db.kysely.selectFrom('user').select('id').where('kind', '=', kind).limit(1),
);
const users = await db.orm.users.where(filter).all();
```

## Links

- [Query Lanes](/docs/architecture%20docs/subsystems/3.%20Query%20Lanes.md)
- [ADR 162 - Kysely lane emits PN SQL AST](/docs/architecture%20docs/adrs/ADR%20162%20-%20Kysely%20lane%20emits%20PN%20SQL%20AST.md)
