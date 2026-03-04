<p align="center">
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-Apache%202.0-blue.svg" alt="License" /></a>
  <a href="https://pris.ly/discord"><img src="https://img.shields.io/discord/937751382725886062?color=5865F2&label=Discord&logo=discord&logoColor=white" alt="Discord" /></a>
  <a href="https://twitter.com/prisma"><img src="https://img.shields.io/twitter/follow/prisma?style=social" alt="Follow @prisma" /></a>
</p>

<p align="center">
  <a href="https://www.prisma.io/docs">Docs</a>
  <span>&nbsp;&nbsp;|&nbsp;&nbsp;</span>
  <a href="https://pris.ly/discord">Discord</a>
  <span>&nbsp;&nbsp;|&nbsp;&nbsp;</span>
  <a href="https://twitter.com/prisma">X</a>
  <span>&nbsp;&nbsp;|&nbsp;&nbsp;</span>
  <a href="https://www.prisma.io/blog">Blog</a>
  <span>&nbsp;&nbsp;|&nbsp;&nbsp;</span>
  <a href="./ARCHITECTURE.md">Architecture</a>
</p>

---

> **Early Preview**: Prisma Next is under active development. APIs will change. Not recommended for production use yet. We'd love for you to explore the source and follow along.

## What is Prisma Next?

Prisma Next is a new data access layer for TypeScript that treats your database schema as a **verifiable contract**: not just a schema file. Instead of generating a heavy client, it emits lightweight types and a deterministic JSON contract, then gives you a composable query DSL at runtime.

Read more about the vision in [The Next Evolution of Prisma ORM](https://www.prisma.io/blog/the-next-evolution-of-prisma-orm).

## Why Prisma Next?

- **Lightweight generation**: Emit types and a contract JSON instead of a full client. No more waiting for codegen on every schema change.
- **Composable query DSL**: Write queries inline with `sql().from(...).select(...)`. Chain, compose, and inspect: no magic methods.
- **Verifiable contracts**: Every contract has a cryptographic hash. Detect schema drift before your app hits production.
- **Plugin guardrails**: Add query budgets, linting rules, and telemetry as composable plugins. Catch `SELECT *` and missing `WHERE` clauses at compile time.
- **AI-native**: Machine-readable contract JSON and structured query plans that AI coding assistants can understand, generate, and verify.

## Quick Example

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

const { tables } = db.schema

const users = await db.sql
  .from(tables.user)
  .select({ id: tables.user.columns.id, email: tables.user.columns.email })
  .limit(10)
  .execute()

// users: Array<{ id: number; email: string }>
```

## Getting Started

### Prerequisites

- Node.js 24 LTS or Bun 1.3.x
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
3. **Query** using a composable DSL that compiles to SQL at runtime, verified against the contract

The contract is the single source of truth. It's diffable, hashable, and machine-readable. Your app, your migrations, and your tools all reference the same artifact.

For a deep dive into the architecture, package organization, and design decisions, see [ARCHITECTURE.md](./ARCHITECTURE.md).

## Status

Prisma Next is in **early preview**. Here's what to expect:

| Area | Status |
|------|--------|
| Schema definition (PSL) | Working* |
| Contract emission | Working* |
| SQL query DSL | Working* |
| ORM-style queries | Working* |
| Postgres adapter | Working* |
| Plugin system | Working* |
| Migrations | Minimal |
| MySQL / SQLite | Not yet |

(*) Working, but not feature-complete or production-ready.

APIs are subject to breaking changes. We're iterating fast and will stabilize before a public release.

## Community

- **Discord**: Join the conversation at [pris.ly/discord](https://pris.ly/discord)
- **X**: Follow [@prisma](https://twitter.com/prisma) for updates
- **Blog**: Read about our journey at [prisma.io/blog](https://www.prisma.io/blog)

Prisma Next is not open to external contributions at this time. See [CONTRIBUTORS.md](./CONTRIBUTORS.md) for details. We plan to open contributions in the future: star and watch this repo to stay in the loop.

## License

Prisma Next is licensed under [Apache 2.0](./LICENSE).
