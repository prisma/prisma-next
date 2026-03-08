# Glossary

User-facing terminology for Prisma Next. This is the **source of truth** for how we name things in documentation, CLI output, error messages, and public APIs.

Where internal terminology currently diverges from the desired user-facing term, the divergence is noted with a refactoring status.

---

## Core Concepts

### Schema

The user's data model definition. A schema lets users describe their application domain and how it maps to persistence mechanisms. For SQL databases, that means tables, columns, relationships, types, and invariants. For document-oriented databases, the persistence mechanisms will differ. Schemas can be authored in PSL (Prisma Schema Language) or via TypeScript builders.

The schema is the **input**; the contract is the **output**. Users think in terms of "my Prisma schema" — the contract is a derived artifact.

### Contract

A canonical, verifiable JSON artifact (`contract.json` + `contract.d.ts`) derived from a schema. The contract describes what exists, what's allowed, and what's expected. It includes hashes (`storageHash`, `profileHash`, optional `executionHash`) for verification against the database.

Users author schemas; the system emits contracts. The contract is a build artifact, not something users typically edit directly.

### Schema Provider

A function that tells the CLI how to read the user's schema and produce a contract.


| Provider             | Description                         |
| -------------------- | ----------------------------------- |
| `prismaSchema()`     | Reads a `.prisma` PSL file          |
| `typescriptSchema()` | Accepts a TypeScript-defined schema |


> **Divergence:** Currently named `prismaContract()` and `typescriptContract()` in code, and the config property is `contract:` instead of `schema:`. These use "contract" where they should use "schema", since they specify the schema source (not the contract artifact). **Status: pending refactor.**

### Extension

A composable, versioned module that adds domain-specific capabilities to Prisma Next (e.g., pgvector for vector search, PostGIS for geospatial). Extensions declare a namespace, contribute schemas for contract decorations, and integrate with authoring, runtime, and migrations.

> **Divergence:** Currently named "extension pack" / `extensionPacks` in code and config. The desired user-facing term is simply "extension" / `extensions`. **Status: pending refactor.**

### Middleware

A composable runtime hook that observes or gates query execution. Middleware can enforce budgets, apply lints, collect telemetry, or enforce policies — without altering the core executor.

Examples: `budgets()`, `lints()`.

> **Divergence:** Currently named "plugin" / `plugins` in code and runtime options. The desired user-facing term is "middleware". **Status: pending refactor.**

### Plan

An immutable, hashable representation of a query or migration operation. Every query compiles to a plan containing SQL, parameters, and metadata (hashes, lane, annotations). Plans are inspectable, portable across environments, and form the basis of all guardrail checks.

### Adapter

A database-specific implementation that lowers abstract plans into dialect-specific SQL and executes them. Adapters advertise capabilities and handle connection-level concerns. The adapter is the boundary between target-agnostic code and database-specific behavior.

### Driver

The transport layer for database communication. A driver manages connections, transactions, and wire-protocol details for a specific database client library (e.g., `pg` for Postgres).

### Target

A concrete database dialect (e.g., Postgres, MySQL). Targets declare which family they belong to and which capabilities they support.

### Family

A database family (e.g., SQL, Document). Family-level code is dialect-agnostic but family-specific — it defines the shape of contracts, query surfaces, and runtime behavior shared across all targets in that family.

---

## Query Surfaces

### SQL DSL

The composable, type-safe query builder. Queries are authored as chained method calls (`sql().from(...).select(...).limit(...)`) and compile to plans.

### ORM

The object-relational mapping surface built on top of the SQL DSL. Provides `findMany`, `create`, `update`, `delete` and relation loading (`include`, `select`).

### Raw SQL

Escape hatch for writing SQL directly. Raw SQL plans still carry annotations so guardrails (budgets, lints, telemetry) apply uniformly.

### TypedSQL

SQL queries defined in `.sql` files with type inference from the contract. Compile to typed plan factories.

---

## Infrastructure

### Capability

A named feature that a database, adapter, or extension supports (e.g., `sql.returning`, `pgvector.ivfflat`). Capabilities are declared in the contract, advertised by adapters, and verified at connect-time.

### Codec

A deterministic encoder/decoder pair for converting between JavaScript values and database wire formats. Extension codecs handle domain-specific types (e.g., vectors, geometries) with branded TypeScript types for compile-time safety.

### Marker

A database-side record storing the `storageHash` and `profileHash` of the last-applied contract. The runtime and migration runner verify marker equality before acting, detecting drift between the contract and the database.

### Namespace

A lowercase identifier that uniquely identifies an extension. Used for PSL attributes (`@pgvector.column()`), contract sections (`extensions.<namespace>`), and capability keys.

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


