# @prisma-next/mongo-query-ast

Typed AST for MongoDB aggregation pipelines with lowering to wire format.

## Responsibilities

- **Filter expressions**: Composable typed filter nodes (`MongoFieldFilter`, `MongoAndExpr`, `MongoOrExpr`, `MongoNotExpr`, `MongoExistsExpr`) representing `$match` predicates
- **Pipeline stages**: Typed stage classes (`MongoMatchStage`, `MongoProjectStage`, `MongoSortStage`, `MongoLimitStage`, `MongoSkipStage`, `MongoLookupStage`, `MongoUnwindStage`) that model aggregation pipeline operations
- **Read plan**: `MongoReadPlan<Row>` — a branded typed representation of a complete read query (collection + stages + metadata)
- **Lowering**: `lowerPipeline`, `lowerStage`, `lowerFilter` — convert typed AST nodes into raw MongoDB aggregation pipeline documents
- **Visitors**: `MongoFilterVisitor`, `MongoFilterRewriter`, `MongoStageVisitor` interfaces for traversing and transforming AST nodes

## Dependencies

- **Depends on**:
  - `@prisma-next/contract` (plan metadata types)
  - `@prisma-next/mongo-core` (document types, param resolution)
- **Depended on by**:
  - `@prisma-next/mongo-orm` (compiles ORM queries into read plans)
  - `@prisma-next/adapter-mongo` (lowers read plans to wire commands)
