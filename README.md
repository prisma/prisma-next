<p align="center">
  <a href="https://github.com/prisma/prisma-next">
    <img src="./images/prisma-next.png" alt="Prisma Next" width="680" />
  </a>
</p>

<p align="center">
  <a href="https://pris.ly/discord">Discord</a>  |  <a href="https://twitter.com/prisma">X</a>  |  <a href="https://pris.ly/pn-anouncement">Blog Post</a>  |  <a href="./ARCHITECTURE.md">Architecture</a>
</p>

<p align="center">
  <a href="./LICENSE"><img alt="License: Apache-2.0" src="https://img.shields.io/badge/license-Apache--2.0-blue.svg" /></a>
  <a href="https://www.npmjs.com/package/prisma-next"><img alt="npm" src="https://img.shields.io/npm/v/prisma-next?label=prisma-next" /></a>
  <a href="https://github.com/prisma/prisma-next/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/prisma/prisma-next/actions/workflows/ci.yml/badge.svg" /></a>
</p>

---

> **In Development (Pre-1.0)**: Prisma Next is an active engineering project and a public look at where Prisma is heading. It is not ready for production yet — pre-1.0, expect breaking changes between minor versions, and only the latest minor receives security fixes. Don't build production applications on Prisma Next yet unless you are prepared to follow upgrades closely.
>
> Prisma 7 remains the recommended version of Prisma for production applications.

## Prisma Next at a glance

**Prisma Next** is a new foundation for Prisma ORM, rewritten fully in TypeScript to be **extensible** and **composable** by default.
Read the full announcement: **[The Next Evolution of Prisma ORM](https://pris.ly/pn-anouncement)**.

- **A TypeScript rewrite of Prisma ORM**: Rebuilt end-to-end to unlock new capabilities and a more composable architecture.
- **Extensible by default**: Add extension packs in `prisma-next.config.ts` to unlock new schema attributes and new query capabilities.
- **Two query APIs**:
  - **ORM Client** (`db.orm`): model collections with fluent `where/include/select` composition
  - **Query builder** (`db.sql`): type-safe SQL plan builder for when you want lower-level control
- **Designed for AI-assisted workflows**: deterministic contracts, structured plans, stable diagnostics, and guardrails that help agents (and humans) iterate safely.

## Getting Started

Drive it yourself, let your agent drive, or hand off mid-flow. Your workflow is up to you — and with Prisma Next, you can delegate with confidence: the contract is verifiable, the diagnostics are structured, and the [agent skills](#use-it-with-your-ai-agent) below teach your editor's AI assistant how to drive the framework end-to-end.

**Try it today in a fresh new project:**

```bash
npx create-prisma@next
```

**Or in a test branch of an existing project:**

```bash
npx prisma-next@latest init
```

Then ask your agent to build something:

> *"Build me a small app that tracks the books I'm reading. Add a few records, and show me the list."*

### Prerequisites

- Node.js 24 or newer
- PostgreSQL or MongoDB (pick at `init` time)
- A package manager — `npm`, `pnpm`, or `yarn`

### What `init` does

`create-prisma@next` creates a new directory and runs `init` inside it. `prisma-next@latest init` does the same thing in the current directory — pick whichever matches your situation. Either way, a single command scaffolds the full project:

- `prisma-next.config.ts` at the repo root
- `src/prisma/contract.prisma` — your schema source, with a starter `User` / `Post` model (PSL is the default; pass `--authoring typescript` for a `contract.ts` builder instead)
- `src/prisma/contract.json` + `contract.d.ts` — emitted contract artefacts (do not hand-edit)
- `src/prisma/db.ts` — runtime entry point the rest of your app imports from
- `.env.example` — copy to `.env` and set `DATABASE_URL`
- `prisma-next.md` — a quick-reference card with the day-to-day commands
- Dependencies installed, `contract emit` run once, and the [agent skills](#use-it-with-your-ai-agent) installed into the project (so they version-track your `prisma-next` deps) and wired up for whichever agent runtimes are present on your machine (Claude Code, Cursor, Codex, …)

`create-prisma@next` prompts you for a project name and creates that directory before scaffolding into it. `prisma-next@latest init` skips the prompt and operates on the current directory — use it when you already have one.

### Next steps after scaffolding

1. Set `DATABASE_URL` in `.env` (copy from `.env.example`). If you don't have a database yet, any local Postgres works — Docker, [Postgres.app](https://postgresapp.com), or a managed instance.
2. Apply the contract to the database: `npx prisma-next db init`. This is a CLI subcommand (`db init`, not a re-run of the scaffold) — it creates the tables, indexes, and constraints your contract describes, then writes a small `pn_meta_marker` row that records the contract hash. The marker is how Prisma Next detects drift between your contract and the live database before queries run.
3. Write your first query (see [Your first query](#your-first-query) below), or ask your agent to do it — the `prisma-next-quickstart` skill takes it from here. The skills are project-local and your editor's agent picks them up on its next prompt; no restart needed for Claude Code or Cursor.

If you get stuck, every `prisma-next` subcommand accepts `--help`, and the `prisma-next-debug` skill knows how to read the structured error envelopes the CLI emits.

### Non-interactive / CI / agent runs

```bash
npx prisma-next@latest init --yes --target postgres --authoring psl
```

The flags `init` accepts (run `prisma-next init --help` for the source of truth):

- `--target <db>` — `postgres` or `mongodb`
- `--authoring <style>` — `psl` (Prisma Schema Language) or `typescript` (programmatic builder)
- `--schema-path <path>` — where to write the contract source
- `--probe-db` — verify `DATABASE_URL` reachability and server version
- `--no-install` — skip dependency install + initial contract emit
- `--no-skill` — skip the Prisma Next agent-skill install (air-gapped / restricted environments)

### Try the in-repo demo

If you'd rather poke at a known-good example before scaffolding your own:

```bash
git clone https://github.com/prisma/prisma-next.git
cd prisma-next
pnpm install && pnpm build

cd examples/prisma-next-demo
# Create .env with your DATABASE_URL, then:
pnpm emit && pnpm seed && pnpm start
```

For a more complete reference app, see the [Pokedex example](https://github.com/prisma/pokedex-prisma-next).

## Your first query

After `npx create-prisma@next` from [Getting Started](#getting-started), your project has a starter schema, the emitted contract, and a typed `db` client ready to use.

**The scaffolded schema** at `src/prisma/contract.prisma` (a `Post` model with a relation to `User` is also generated; trimmed here for clarity):

```prisma
model User {
  id    Int     @id @default(autoincrement())
  email String  @unique
  name  String?
}
```

**The scaffolded client** at `src/prisma/db.ts` (generated for you; do not hand-edit — the MongoDB scaffold uses `@prisma-next/mongo/runtime` here instead):

```typescript
import postgres from '@prisma-next/postgres/runtime'
import type { Contract } from './contract.d'
import contractJson from './contract.json' with { type: 'json' }

export const db = postgres<Contract>({
  contractJson,
  url: process.env['DATABASE_URL']!,
})
```

**Your first query** — save the snippet at `src/first-query.ts`:

```typescript
import 'dotenv/config'
import { db } from './prisma/db'

const users = await db.orm.User
  .select('id', 'email')
  .take(10)
  .all()

// users: Array<{ id: number; email: string }>
console.log(users)
```

Run it with `tsx`:

```bash
npx tsx src/first-query.ts
```

Edit `contract.prisma`, run `npx prisma-next contract emit`, and the `db` types update in lockstep — query autocomplete, return types, capability checks, everything.

## Use it with your AI agent

`init` already wired this up — you don't need to do anything to opt in. This section is here so you (and any agent reading the repo) know what's in your project and where to find it.

Prisma Next ships with a cluster of **agent skills** — `SKILL.md` files that teach an LLM agent how to drive the framework end-to-end without re-deriving the API from documentation each turn. Each skill has a `description` field the agent runtime matches against the user's prompt, so the right skill loads at the right moment.

| Skill | When the agent uses it |
|---|---|
| `prisma-next` | Router — catches vague prompts and routes to a specific skill. |
| `prisma-next-quickstart` | First-touch orientation, greenfield, and brownfield-DB adoption. |
| `prisma-next-contract` | Authoring the contract (PSL, TS builder, no-emit). |
| `prisma-next-migrations` | `db update`, `migration plan`, `migrate`, data transforms. |
| `prisma-next-migration-review` | Deployment + concurrency review on merge. |
| `prisma-next-queries` | ORM client, SQL DSL, raw SQL, TypedSQL. |
| `prisma-next-runtime` | Wiring `db.ts`, middleware, env, connection. |
| `prisma-next-build` | Build-system / dev-server integration (Vite plugin today). |
| `prisma-next-debug` | Decoding structured error envelopes and PN-* codes. |
| `prisma-next-feedback` | Hand a bug / feature request to the team. |

The skills live inside your project (so they version-lock to your `prisma-next` deps) and are wired to whichever agent runtimes are present on your machine.

**To install the skills into a project that already exists** (or after adding a new agent runtime to one), re-run `init` — it detects the existing scaffold and re-registers the skill cluster:

```bash
npx prisma-next@latest init
```

**Sources, structure, and authoring rules** live in [`skills/README.md`](./skills/README.md) and [`skills/DEVELOPING.md`](./skills/DEVELOPING.md). If you're an agent reading this README, that's where to look next.

## Schema as a contract

Your schema becomes a **verifiable contract**: a deterministic artifact (`contract.json` + TypeScript types) that describes which models, tables, and fields exist.

- **Verify at runtime**: detect schema drift before a query runs
- **Type your queries**: keep results and query operators fully type-safe
- **Power tooling + agents**: contracts, plans, and diagnostics are structured data — easy to inspect, diff, and reason about

## Fluent query API

Queries remain readable and composable as they grow, with fully-typed autocompletion:

```typescript
const orders = await db.orders
  .where({ userId: currentUserId })
  .where((o) => o.status.in(['shipped', 'delivered']))
  .include('shippingAddress')
  .include('items', (item) =>
    item.include('product', (product) =>
      product
        .include('category')
        .include('images', (img) => img.where({ isPrimary: true }).take(1))
        .include('reviews', (reviews) =>
          reviews
            .where((r) => r.rating.gte(4))
            .orderBy((r) => r.createdAt.desc())
            .take(3)
            .include('author', (a) => a.select('name', 'avatar')),
        ),
    ),
  )
  .all()
```

## Designed for AI-assisted workflows

Every operation produces structured output that machines can understand. Compile-time guardrails catch mistakes before runtime, and machine-readable errors include stable codes and suggested fixes:

```typescript
// Type error: update() requires where()
await db.users.update({ active: false })
```

```json
{
  "code": "CAPABILITY_REQUIRED",
  "message": "updateAll() requires 'returning' capability",
  "fix": "Add 'returning' to contract capabilities or use updateCount()"
}
```

## Extensibility (extension packs)

Add an extension pack in `prisma-next.config.ts` to unlock new schema attributes and query operators. For example, `pgvector`:

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

```typescript
await posts
  .where(p => p.embedding.cosineDistance(searchParam).lt(0.2))
  .all()
```

## How It Works

Prisma Next follows a three-step **contract-first** workflow:

1. **Define** your schema in PSL (Prisma Schema Language)
2. **Emit** a deterministic contract (JSON) and TypeScript types: no executable code generated
3. **Query** using either `db.orm` (ORM Client) or `db.sql` (query builder), verified against the contract

The contract is the single source of truth. It's diffable, hashable, and machine-readable.

For architecture details, see [ARCHITECTURE.md](./ARCHITECTURE.md).

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

(*) Working, but not feature-complete or production-ready. APIs are subject to breaking changes.

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md) for setup, the test/lint/typecheck command set, DCO signoff, and PR expectations. For substantive changes please open an issue first so we can give you direction-fit feedback before you invest implementation time.

Security issues should not be filed as public issues — please follow the Private Vulnerability Reporting flow described in [SECURITY.md](./SECURITY.md).

## Community

- **Discord**: Join the conversation at [pris.ly/discord](https://pris.ly/discord)
- **X**: Follow [@prisma](https://twitter.com/prisma) for updates
- **Blog**: Read about our journey at [prisma.io/blog](https://www.prisma.io/blog)

Built something with Prisma Next? Tag [us on X](https://pris.ly/x) — the best community builds get a shout-out from the Prisma account and a link in this README.

## License

Prisma Next is licensed under [Apache 2.0](./LICENSE).
