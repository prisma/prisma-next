# @prisma-next/mongo-query-ast

Typed AST for MongoDB filters, pipeline stages, and command variants, plus the unified **query plan** envelope.

## Responsibilities

- **Filter expressions**: Composable typed filter nodes (`MongoFieldFilter`, `MongoAndExpr`, `MongoOrExpr`, `MongoNotExpr`, `MongoExistsExpr`) representing `$match` predicates
- **Pipeline stages**: Typed stage classes (`MongoMatchStage`, `MongoProjectStage`, `MongoSortStage`, `MongoLimitStage`, `MongoSkipStage`, `MongoLookupStage`, `MongoUnwindStage`) that model aggregation pipeline operations
- **Commands**: `AnyMongoCommand` and related command types (reads, writes, aggregates) carried on a plan
- **Query plan**: `MongoQueryPlan<Row>` — a branded typed representation with shape `{ collection, command: AnyMongoCommand, meta: PlanMeta }`
- **Visitors**: `MongoFilterVisitor`, `MongoFilterRewriter`, `MongoStageVisitor` interfaces for traversing and transforming AST nodes

Lowering typed nodes to wire BSON is performed by `@prisma-next/adapter-mongo` via `lower(plan)` on `MongoQueryPlan`, which dispatches on `command.kind` and uses internal helpers for filters and pipelines.

## Dependencies

- **Depends on**:
  - `@prisma-next/contract` (plan metadata types)
  - `@prisma-next/mongo-value` (document types, param resolution)
- **Depended on by**:
  - `@prisma-next/mongo-orm` (compiles ORM queries into `MongoQueryPlan`)
  - `@prisma-next/adapter-mongo` (`lower(plan)` from `MongoQueryPlan` to wire commands)
