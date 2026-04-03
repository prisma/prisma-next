# Mongo Demo

End-to-end example of Prisma Next with MongoDB, demonstrating the full **authoring → emit → runtime** pipeline using the contract-first approach.

## What it shows

- PSL schema (`prisma/schema.psl`) as the authoring surface for MongoDB
- Contract emission via `@prisma-next/mongo-contract-psl` and `@prisma-next/family-mongo`
- Runtime query execution using `mongoOrm()` with the emitted contract
- Reference relation resolution via `$lookup` (Post → User)
- Integration tests against an in-memory MongoDB replica set

## Schema

The demo uses a blog schema with two models and a reference relation:

```
User (id, name, email, bio?) ←1:N→ Post (id, title, content, authorId, createdAt)
```

See [`prisma/schema.psl`](prisma/schema.psl).

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
| `pnpm emit`    | Parse `prisma/schema.psl` and emit `src/contract.json` + `src/contract.d.ts` |
| `pnpm test`    | Run integration tests against an in-memory MongoDB replica set              |
| `pnpm dev`     | Start the Vite dev server (React UI)                                        |
| `pnpm dev:api` | Start the API server (`src/server.ts`)                                      |

## How emission works

`scripts/generate-contract.ts` runs the full pipeline:

1. Parses `prisma/schema.psl` with `@prisma-next/psl-parser`
2. Interprets the parsed document into a `ContractIR` via `@prisma-next/mongo-contract-psl`
3. Assembles a control stack with `mongoFamilyDescriptor` and `mongoTargetDescriptor`
4. Calls `emitContract()` to produce `contract.json` and `contract.d.ts`

## How the runtime works

`src/db.ts` composes the Mongo runtime stack:

1. Validates the emitted contract with `validateMongoContract()`
2. Creates a `MongoAdapter` and `MongoDriver`
3. Creates a `MongoRuntime` for query execution
4. Creates an ORM surface via `mongoOrm()` with typed collection accessors (`orm.users`, `orm.posts`)

## Key files

| File                            | Purpose                                            |
| ------------------------------- | -------------------------------------------------- |
| `prisma/schema.psl`            | PSL schema (authoring surface)                     |
| `scripts/generate-contract.ts` | Emission script (PSL → ContractIR → contract artifacts) |
| `src/contract.json`            | Emitted contract (generated, do not edit)           |
| `src/contract.d.ts`            | Emitted type definitions (generated, do not edit)   |
| `src/db.ts`                    | Runtime composition (adapter → driver → runtime → ORM) |
| `test/blog.test.ts`            | Integration tests using `mongodb-memory-server`    |

## Comparison with prisma-next-demo

| Aspect        | `prisma-next-demo` (SQL)                    | `mongo-demo` (MongoDB)                      |
| ------------- | ------------------------------------------- | ------------------------------------------- |
| Target        | PostgreSQL                                  | MongoDB                                     |
| Schema        | `schema.prisma` (PSL)                       | `schema.psl` (PSL)                          |
| Emission      | CLI (`prisma-next emit`)                    | Script (`pnpm emit`)                        |
| Runtime       | `postgres()` one-liner                      | `createMongoAdapter()` + `createMongoDriver()` + `createMongoRuntime()` + `mongoOrm()` |
| Relations     | SQL joins                                   | `$lookup` aggregation pipeline              |
| Tests         | Requires running PostgreSQL                 | Uses `mongodb-memory-server` (no external DB) |
