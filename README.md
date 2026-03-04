

[Docs](https://www.prisma.io/docs)  |  [Discord](https://pris.ly/discord)  |  [X](https://twitter.com/prisma)  |  [Blog](https://www.prisma.io/blog)  |  [Architecture](./ARCHITECTURE.md)

---

> **In Development (Not a Product Release)**: Prisma Next is an active engineering project and a public look at where Prisma is heading. It is not ready for production  yet: APIs will change, and it’s not recommended for production use.
>
> Prisma 7 remains the recommended version of Prisma for production applications.

## Prisma Next at a glance

- **A TypeScript rewrite of Prisma ORM**: Rebuilt end-to-end to unlock new capabilities and a more composable architecture.
- **Extensible by default**: Add extension packs in `prisma-next.config.ts` to unlock new schema attributes and new query capabilities.
- **Two query APIs**:
  - **ORM Client** (`db.orm`): model collections with fluent `where/include/select` composition
  - **Query builder** (`db.sql`): type-safe SQL plan builder for when you want lower-level control
- **Designed for AI-assisted workflows**: deterministic contracts, structured plans, stable diagnostics, and guardrails that help agents (and humans) iterate safely.

Read the deep dive in `[blog-post.md](./blog-post.md)` and the announcement blog post: [The Next Evolution of Prisma ORM](https://www.prisma.io/blog/the-next-evolution-of-prisma-orm).

## Designed for AI-assisted workflows

Prisma Next is built for agent-assisted development:

- **Fast, predictable feedback**: type-state APIs and capability checks catch mistakes early
- **Machine-readable artifacts**: contracts, query plans, and diagnostics are structured data
- **Guardrails you can compose**: plugins can enforce budgets, policies, and telemetry

See `[blog-post.md](./blog-post.md)` for the full rationale and examples.

## Schema as a contract

In Prisma Next, your schema becomes a **verifiable contract**: a deterministic artifact (`contract.json` + TypeScript types) that describes which models, tables, and fields exist.

That contract is used to:

- **Verify at runtime**: detect schema drift before a query runs
- **Type your queries**: keep results and query operators fully type-safe
- **Power tooling + agents**: contracts, plans, and diagnostics are structured data—easy to inspect, diff, and reason about

For architecture details, see [ARCHITECTURE.md](./ARCHITECTURE.md).

## Quick example

**1. Define your schema:**

```prisma
// schema.psl
model User {
  id    Int     @id @default(autoincrement())
  email String  @unique
  name  String?
}
```

**2. Emit the contract:**

```bash
prisma-next contract emit schema.psl -o .prisma
# Generates: .prisma/contract.json + .prisma/contract.d.ts
```

**3. Query with full type safety:**

```typescript
import postgres from '@prisma-next/postgres/runtime'
import type { Contract } from './.prisma/contract.d'
import contractJson from './.prisma/contract.json' with { type: 'json' }

const db = postgres<Contract>({
  contractJson,
  url: process.env['DATABASE_URL']!,
})

const users = await db.orm.users
  .select('id', 'email')
  .take(10)
  .all()

// users: Array<{ id: number; email: string }>
```

`all()` returns an async-iterable result, so you can also stream:

```typescript
for await (const user of db.orm.users.select('id', 'email').all()) {
  // process(user)
}
```

## Query APIs

### ORM Client (`db.orm`)

Use the ORM Client for model-centric queries, relation traversal, and model-level writes.

### Query builder (`db.sql`)

When you want lower-level control, use the type-safe query builder to assemble a plan and execute it through the runtime:

```typescript
const plan = db.sql
  .from(db.schema.tables.user)
  .select({
    id: db.schema.tables.user.columns.id,
    email: db.schema.tables.user.columns.email,
  })
  .limit(10)
  .build()

const rows = await db.runtime().execute(plan).toArray()
```

## Extensibility (extension packs)

Prisma Next is designed to be extended. Add an extension pack in `prisma-next.config.ts`, and you can use it in your schema and your queries.

For example, enabling `pgvector` makes the `@pgvector.*` schema attributes and vector query operators available:

```ts
// prisma-next.config.ts
import { defineConfig } from '@prisma-next/cli/config-types'
import pgvector from '@prisma-next/extension-pgvector/control'

export default defineConfig({
  // ...
  extensionPacks: [pgvector],
})
```

```prisma
model Document {
  id        Int    @id
  title     String
  embedding Bytes  @pgvector.column(length: 1536)
}
```

## Getting Started

### Prerequisites

- Node.js 24 LTS (or newer)
- pnpm
- PostgreSQL

### Try the demo

```bash
git clone https://github.com/prisma/prisma-next.git
cd prisma-next
pnpm install && pnpm build

cd examples/prisma-next-demo
# Create .env with your DATABASE_URL, then:
pnpm emit && pnpm seed && pnpm start
```

## How It Works

Prisma Next follows a three-step **contract-first** workflow:

1. **Define** your schema in PSL (Prisma Schema Language)
2. **Emit** a deterministic contract (JSON) and TypeScript types: no executable code generated
3. **Query** using either `db.orm` (ORM Client) or `db.sql` (query builder), verified against the contract

The contract is the single source of truth. It's diffable, hashable, and machine-readable. Your app, your migrations, and your tools all reference the same artifact.

For a deep dive into the architecture, package organization, and design decisions, see [ARCHITECTURE.md](./ARCHITECTURE.md).

## Status

Prisma Next is in development. Here's what to expect:


| Area                    | Status   |
| ----------------------- | -------- |
| Schema definition (PSL) | Working* |
| Contract emission       | Working* |
| SQL query DSL           | Working* |
| ORM-style queries       | Working* |
| Postgres adapter        | Working* |
| Plugin system           | Working* |
| Migrations              | Minimal  |
| MySQL / SQLite          | Not yet  |


(*) Working, but not feature-complete or production-ready.

APIs are subject to breaking changes.

## Community

- **Discord**: Join the conversation at [pris.ly/discord](https://pris.ly/discord)
- **X**: Follow [@prisma](https://twitter.com/prisma) for updates
- **Blog**: Read about our journey at [prisma.io/blog](https://www.prisma.io/blog)

Prisma Next is not open to external contributions at this time. See [CONTRIBUTORS.md](./CONTRIBUTORS.md) for details. We plan to open contributions in the future: star and watch this repo to stay in the loop.

## License

Prisma Next is licensed under [Apache 2.0](./LICENSE).