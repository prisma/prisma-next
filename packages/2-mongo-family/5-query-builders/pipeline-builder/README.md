# @prisma-next/mongo-pipeline-builder

Type-safe MongoDB aggregation pipeline builder with document shape tracking.

## What it does

Builds `MongoQueryPlan` instances from a fluent, chainable API. The builder tracks document shape transformations at the type level — each stage method returns a new builder whose shape reflects the transformation (e.g. `group()` replaces the shape with the grouped fields, `project()` narrows it, `addFields()` extends it).

## When to use it

Use this package when you need to construct MongoDB aggregation pipelines with compile-time guarantees that:

- Field references are valid for the current pipeline stage
- Sort/filter operations only target existing fields
- The final output type reflects all shape transformations

## Usage

```typescript
import { mongoPipeline, fn, acc } from '@prisma-next/mongo-pipeline-builder';
import type { Contract, TypeMaps } from './contract.d';
import contractJson from './contract.json' with { type: 'json' };

type TContract = MongoContractWithTypeMaps<Contract, TypeMaps>;

const p = mongoPipeline<TContract>({ contractJson });

// Analytics query: revenue by department
const plan = p
  .from('orders')
  .match((f) => f.status.eq('completed'))
  .group((f) => ({
    _id: f.department,
    totalRevenue: acc.sum(f.amount),
    count: acc.count(),
  }))
  .sort({ totalRevenue: -1 })
  .limit(10)
  .build();

// plan is MongoQueryPlan<{ _id: string; totalRevenue: number; count: number }>
```

## API

### Entry point

- `mongoPipeline<TContract>({ contractJson })` — returns a `PipelineRoot` with `.from(rootName)` to start building

### Stage methods

| Method | Shape effect |
|--------|-------------|
| `match(filter)` / `match(fn)` | Preserves shape |
| `sort(spec)` | Preserves shape (keys constrained to current fields) |
| `limit(n)`, `skip(n)`, `sample(n)` | Preserves shape |
| `addFields(fn)` | Extends shape with new fields |
| `project(...keys)` | Narrows shape to selected fields |
| `project(fn)` | Replaces shape with computed projection |
| `group(fn)` | Replaces shape with grouped/accumulated fields |
| `unwind(field)` | Unwraps array field to element type |
| `lookup(opts)` | Adds array field from foreign collection |
| `replaceRoot(fn)` | Replaces entire shape |
| `count(field)` | Replaces shape with single count field |
| `sortByCount(fn)` | Replaces shape with `{ _id, count }` |
| `pipe(stage)` | Escape hatch — preserves or asserts new shape |

### Helpers

- **`fn`** — Expression helpers: `add`, `subtract`, `multiply`, `divide`, `concat`, `toLower`, `toUpper`, `size`, `cond`, `literal`
- **`acc`** — Accumulator helpers: `sum`, `avg`, `min`, `max`, `first`, `last`, `push`, `addToSet`, `count`

### Terminal

- `build()` — produces `MongoQueryPlan<ResolvedRow>` with the fully resolved output type

## Architecture

See [DEVELOPING.md](./DEVELOPING.md) for internal implementation details.
