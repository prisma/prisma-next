# Glossary

User-facing terminology for Prisma Next. This is the **source of truth** for how we name things in documentation, CLI output, error messages, and public APIs.

Where internal terminology currently diverges from the desired user-facing term, the divergence is noted with a refactoring status.

---

## Core Concepts

### Schema

A schema lets users describe their application domain and how it maps to persistence mechanisms. For SQL databases, that means tables, columns, relationships, types, and invariants. For document-oriented databases, the persistence mechanisms will differ. Schemas can be authored in PSL (Prisma Schema Language) or via TypeScript builders.

The schema is the **input**; the contract is the **output**. Users think in terms of "my Prisma schema" — the contract is a derived artifact.

### Contract

A verifiable agreement between an application and its database. The application declares what models it depends on and how they map to storage; the database guarantees it provides the required structures. Emitted as `contract.json` + `contract.d.ts`, the application carries its contract and the database is signed with the contract's hash to make the agreement verifiable at both migration and runtime.

Users author schemas; the system emits contracts. The contract is a build artifact like `package-lock.json`, not something users typically edit directly.

### Schema Provider

The part of your config that tells Prisma Next where your schema lives and what format it's in. Prisma Next ships two built-in providers:

| Provider | Description |
|---|---|
| `prismaSchema()` | Reads a `.prisma` PSL file |
| `typescriptSchema()` | Accepts a TypeScript-defined schema |

> **Divergence:** Currently named `prismaContract()` and `typescriptContract()` in code, and the config property is `contract:` instead of `schema:`. These use "contract" where they should use "schema", since they specify the schema source (not the contract artifact). **Status: pending refactor.**

### Extension

An installable package that adds features to Prisma Next — new data types, database-specific operations, or custom behavior. For example, the pgvector extension adds vector search support. Extensions integrate across the full stack: they can extend your schema language, contribute to the contract, and provide runtime behavior.

> **Divergence:** Currently named "extension pack" / `extensionPacks` in code and config. The desired user-facing term is simply "extension" / `extensions`. **Status: pending refactor.**

### Middleware

A function that runs around every query, similar to middleware in Express or Koa. Middleware can inspect queries, enforce limits, collect metrics, or block unsafe operations — without changing how queries are built or executed. Examples: `budgets()` (cost limits), `lints()` (query checks).

> **Divergence:** Currently named "plugin" / `plugins` in code and runtime options. The desired user-facing term is "middleware". **Status: pending refactor.**

### Plan

The compiled form of a query. Before anything touches the database, Prisma Next compiles your query into a plan — the exact SQL, parameters, and metadata. Plans are inspectable, so you (or your tooling) can see exactly what will execute. Guardrails like budgets and lints operate on plans, not raw queries.

### Adapter

The piece that translates your queries into the specific SQL dialect your database understands and executes them. Each database has its own adapter (e.g., Postgres). Adapters also report what features the database supports, so Prisma Next can check at startup whether your contract's requirements are met.

### Driver

The library that handles the actual network connection to your database. A driver manages connections, transactions, and wire-protocol details for a specific database client (e.g., `pg` for Postgres). Most users configure a driver once and don't interact with it directly.

### Target

Which specific database you're using — Postgres, MySQL, etc. Each target belongs to a family (e.g., Postgres is an SQL target) and supports a specific set of capabilities.

### Family

A category of databases that share fundamental characteristics. SQL is a family — Postgres, MySQL, and SQLite are all SQL targets that share concepts like tables, columns, and joins. Prisma Next defines shared behavior at the family level so individual targets only need to handle what's specific to them.

---

## Query Surfaces

### Query Builder

A type-safe interface for constructing queries that compile to plans. Each query builder is subject to the **one-query-one-statement rule**: a single builder call produces exactly one SQL statement. Prisma Next provides several query builders:

- **SQL query builder** — composable, relational query construction via chained method calls (`sql().from(...).select(...).limit(...)`)
- **Raw SQL query builder** — write SQL directly when the DSL doesn't cover your use case. Raw SQL queries still go through the same guardrails (budgets, lints, telemetry) as builder queries.

Future: **Typed SQL query builder** — write queries in `.sql` files and get full type safety, with parameter and result types inferred from your contract.

> **Divergence:** Currently named "query lane" / "lane" in code and architecture docs. The desired user-facing term is "query builder". **Status: pending refactor.**

### ORM Client

A higher-level query interface that coordinates multiple queries on your behalf. Unlike query builders, the ORM client is **not** bound by the one-query-one-statement rule — operations like `findMany` with `include` may issue several queries behind the scenes to load related data. Provides `findMany`, `create`, `update`, `delete` and relation loading (`include`, `select`).

---

## Infrastructure

### Capability

A specific feature that a database may or may not support (e.g., `RETURNING` clauses, vector indexes). Your contract declares which capabilities it needs; the adapter reports which ones the database provides. Prisma Next checks these match at startup, so you find out about missing features immediately rather than at query time.

### Codec

Handles the translation between JavaScript values and database values. When you read a timestamp from the database, a codec converts it to a JavaScript `Date`; when you write it back, the codec converts it the other way. Extensions provide codecs for specialized types like vectors or geometries.

### Marker

A small record stored in the database that tracks which contract is currently applied. Before running queries or migrations, Prisma Next checks that the marker matches the contract the application is carrying. This catches situations where the database and application have drifted out of sync — for example, if a migration was applied but the application wasn't redeployed.

### Namespace

A unique name that identifies an extension. Namespaces keep extensions from colliding with each other and with built-in features. You'll see them in PSL attributes (`@pgvector.column()`), in the contract (`extensions.pgvector`), and in capability names (`pgvector.ivfflat`).

---

## Terminology Alignment Tracker

Planned refactors to bring internal naming in line with user-facing terminology:


| User-facing term          | Current internal term               | Scope                                                             | Status  |
| ------------------------- | ----------------------------------- | ----------------------------------------------------------------- | ------- |
| extension / `extensions`  | extension pack / `extensionPacks`   | Config property, types, docs, CLI output, error messages          | Pending |
| middleware / `middleware` | plugin / `plugins`                  | Runtime options, types, docs                                      | Pending |
| `prismaSchema()`          | `prismaContract()`                  | `@prisma-next/sql-contract-psl/provider` export                   | Pending |
| `typescriptSchema()`      | `typescriptContract()`              | `@prisma-next/sql-contract-ts/config-types` export                | Pending |
| `schema:` config property | `contract:` config property         | `PrismaNextConfig`, `defineConfig`, examples, CLI internals, docs | Pending |
| schema provider           | contract provider / contract source | Config types, docs, internal naming                               | Pending |
| query builder             | query lane / lane                   | Architecture docs, package names, internal naming                 | Pending |


