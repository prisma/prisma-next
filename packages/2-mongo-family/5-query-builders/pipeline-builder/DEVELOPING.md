# Developing @prisma-next/mongo-pipeline-builder

Internal architecture notes for contributors.

## Module structure

| File | Responsibility |
|------|---------------|
| `pipeline.ts` | Entry point (`mongoPipeline`) — validates root, creates initial builder |
| `builder.ts` | `PipelineBuilder` class — immutable; each stage method returns a new instance with the appended stage |
| `types.ts` | Core type machinery: `DocField`, `DocShape`, `ModelToDocShape`, `ResolveRow`, shape transformers (`ProjectedShape`, `GroupedDocShape`, `UnwoundShape`, etc.) |
| `field-proxy.ts` | `Proxy`-based `FieldProxy<Shape>` — intercepts property access to produce `TypedAggExpr` nodes |
| `filter-proxy.ts` | `Proxy`-based `FilterProxy<Shape>` — intercepts property access to produce `FilterHandle` objects |
| `expression-helpers.ts` | `fn` object — thin wrappers around `MongoAggOperator` / `MongoAggCond` / `MongoAggLiteral` |
| `accumulator-helpers.ts` | `acc` object — thin wrappers around `MongoAggAccumulator` |

## Key design decisions

### Immutable builder

Every stage method clones state and returns a new `PipelineBuilder`. This allows branching pipelines from a shared prefix without mutation.

### Phantom `_field` on expressions

`TypedAggExpr<F>` and `TypedAccumulatorExpr<F>` carry a phantom `_field: F` property that exists only at the type level (`undefined as never` at runtime). The generic `F` propagates through the type system to track the resulting shape. Nothing reads `_field` at runtime.

### Proxy mechanics

`FieldProxy` and `FilterProxy` use ES `Proxy` with a `get` trap that converts property names to AST nodes. Both guard against symbol access (e.g. `Symbol.toPrimitive`) by returning `undefined` for symbol properties.

## Package dependencies

- `@prisma-next/mongo-contract` — contract types (`MongoContract`, `MongoContractWithTypeMaps`)
- `@prisma-next/mongo-query-ast` — AST node constructors (`AggregateCommand`, stage classes, expression classes)
- `@prisma-next/mongo-value` — `MongoValue` type for filter comparisons
- `@prisma-next/contract` — `PlanMeta` type

## Running tests

```bash
pnpm test        # unit + type tests via vitest
pnpm typecheck   # tsc --noEmit
```

Integration tests live in `packages/2-mongo-family/7-runtime/test/pipeline-builder.test.ts` and require `mongodb-memory-server`.
