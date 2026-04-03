# Mongo Demo

End-to-end example of Prisma Next with MongoDB, demonstrating the full **authoring → emit → runtime** pipeline using the contract-first approach.

## What it shows

- PSL schema (`prisma/contract.prisma`) as the authoring surface for MongoDB
- Contract emission via `prisma-next.config.ts` and the CLI (`prisma-next contract emit`)
- Runtime query execution using `mongoOrm()` with the emitted contract
- Reference relation resolution via `$lookup` (Post → User)
- Integration tests against an in-memory MongoDB replica set

## Schema

The demo uses a blog schema with two models and a reference relation:

```
User (id, name, email, bio?) ←1:N→ Post (id, title, content, authorId, createdAt)
```

See [`prisma/contract.prisma`](prisma/contract.prisma).

## Quick start

```bash
# 1. Build dependencies (from repo root)
pnpm build

# 2. Generate contract artifacts from the PSL schema
pnpm emit

# 3. Run integration tests (uses mongodb-memory-server, no external DB needed)
pnpm test
```

## Scripts

| Script         | Description                                                                 |
| -------------- | --------------------------------------------------------------------------- |
| `pnpm emit`    | Emit `src/contract.json` + `src/contract.d.ts` via `prisma-next contract emit` |
| `pnpm test`    | Run integration tests against an in-memory MongoDB replica set              |
| `pnpm dev`     | Start the Vite dev server (React UI)                                        |
| `pnpm dev:api` | Start the API server (`src/server.ts`)                                      |

## How emission works

`prisma-next.config.ts` wires the Mongo family, target, and adapter descriptors together with a `mongoContract()` provider. Running `pnpm emit` invokes the CLI's `contract emit` command, which:

1. Loads `prisma-next.config.ts` and creates a control stack
2. Reads and parses `prisma/contract.prisma` via the `mongoContract()` provider
3. Interprets the parsed document into a `ContractIR`
4. Emits `src/contract.json` and `src/contract.d.ts`

## How the runtime works

`src/db.ts` composes the Mongo runtime stack:

1. Validates the emitted contract with `validateMongoContract()`
2. Creates a `MongoAdapter` and `MongoDriver`
3. Creates a `MongoRuntime` for query execution
4. Creates an ORM surface via `mongoOrm()` with typed collection accessors (`orm.users`, `orm.posts`)

## Key files

| File                            | Purpose                                            |
| ------------------------------- | -------------------------------------------------- |
| `prisma/contract.prisma`       | PSL schema (authoring surface)                     |
| `prisma-next.config.ts`        | CLI config (family + target + adapter + contract provider) |
| `src/contract.json`            | Emitted contract (generated, do not edit)           |
| `src/contract.d.ts`            | Emitted type definitions (generated, do not edit)   |
| `src/db.ts`                    | Runtime composition (adapter → driver → runtime → ORM) |
| `test/blog.test.ts`            | Integration tests using `mongodb-memory-server`    |

## Comparison with prisma-next-demo

| Aspect        | `prisma-next-demo` (SQL)                    | `mongo-demo` (MongoDB)                      |
| ------------- | ------------------------------------------- | ------------------------------------------- |
| Target        | PostgreSQL                                  | MongoDB                                     |
| Schema        | `schema.prisma` (PSL)                       | `contract.prisma` (PSL)                     |
| Emission      | CLI (`prisma-next contract emit`)           | CLI (`prisma-next contract emit`)           |
| Runtime       | `postgres()` one-liner                      | `createMongoAdapter()` + `createMongoDriver()` + `createMongoRuntime()` + `mongoOrm()` |
| Relations     | SQL joins                                   | `$lookup` aggregation pipeline              |
| Tests         | Requires running PostgreSQL                 | Uses `mongodb-memory-server` (no external DB) |
