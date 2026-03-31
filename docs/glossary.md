# Glossary

User-facing terminology for Prisma Next. This is the **source of truth** for how we name things in documentation, CLI output, error messages, and public APIs.

Where internal terminology currently diverges from the desired user-facing term, the divergence is noted with a refactoring status.

---

## Core Concepts

### Contract

A verifiable agreement between an application and its database. Users author their contract in PSL (Prisma Schema Language) or TypeScript builders — describing models, fields, relations, and how they map to storage. The system compiles this into `contract.json` + `contract.d.ts`, which downstream tools (ORM, runtime, migrations) consume. The authored contract definition is the user's source of truth; `contract.json` is a derived build artifact in the same sense as `package-lock.json`.

The application carries its contract and the database is signed with the contract's hash, making the agreement verifiable at both migration and runtime.

### Schema

The structure of the database itself — tables, columns, indexes, constraints (SQL) or collections and indexes (MongoDB). The schema lives in the database; the contract lives in source code. Prisma Next manages the schema through migrations that bring the database in line with the contract.

In other ORMs, "schema" often refers to the user-authored model definitions. In Prisma Next, that's the contract. "Schema" refers specifically to the database's actual structure.

### Contract Provider

The part of your config that tells Prisma Next where your contract source lives and what format it's in. Prisma Next ships two built-in providers:

| Provider               | Description                              |
| ---------------------- | ---------------------------------------- |
| `prismaContract()`     | Reads a `.prisma` PSL file               |
| `typescriptContract()` | Accepts a TypeScript-defined contract    |

Configured via the `contract:` property in `prisma-next.config.ts`.

### Extension

An installable package that adds features to Prisma Next — new data types, database-specific operations, or custom behavior. For example, the pgvector extension adds vector search support. Extensions integrate across the full stack: they can extend the contract language, contribute types and capabilities, and provide runtime behavior.

> **Divergence:** Currently named "extension pack" / `extensionPacks` in code and config. The desired user-facing term is simply "extension" / `extensions`. **Status: pending refactor.**

### Middleware

A function that runs around every query, similar to middleware in Express or Koa. Middleware can inspect queries, enforce limits, collect metrics, or block unsafe operations — without changing how queries are built or executed. Examples: `budgets()` (cost limits), `lints()` (query checks).

> **Divergence:** Currently named "plugin" / `plugins` in code and runtime options. The desired user-facing term is "middleware". **Status: pending refactor.**

### Plan

The compiled form of a query. Before anything touches the database, Prisma Next compiles your query into a plan — the query payload, parameters, and metadata. Plans are inspectable, so you (or your tooling) can see exactly what will execute. Guardrails like budgets and lints operate on plans, not raw queries. Each family has its own plan type — `SqlQueryPlan` carries a SQL string and parameters; `MongoQueryPlan` carries a command (find, insert, update, delete, or aggregate pipeline).

### Adapter

The piece that connects Prisma Next to a specific database. For SQL targets, the adapter translates queries into the correct dialect. For MongoDB, the adapter dispatches commands to the `mongodb` Node.js driver. Adapters also report what features the database supports, so Prisma Next can check at startup whether your contract's requirements are met.

### Driver

The library that handles the actual network connection to your database. A driver manages connections, transactions, and wire-protocol details for a specific database client (e.g., `pg` for Postgres, `mongodb` for MongoDB). Most users configure a driver once and don't interact with it directly.

### Target

Which specific database you're using — Postgres, MySQL, MongoDB, etc. Each target belongs to a family (e.g., Postgres is a SQL target; MongoDB is a Mongo target) and supports a specific set of capabilities.

### Family

A category of databases that share fundamental characteristics. SQL is a family — Postgres, MySQL, and SQLite are all SQL targets that share concepts like tables, columns, and joins. MongoDB is its own family (not a target under a generic "document" family). Prisma Next defines shared behavior at the family level so individual targets only need to handle what's specific to them.

---

## Domain Modeling

### Aggregate Root

A model that owns its own storage unit (table or collection) and serves as an ORM entry point. In the contract, aggregate roots are declared in the `roots` section, which maps ORM accessor names to model names (e.g., `"users": "User"` produces `db.users`). Models not in `roots` are only reachable through a parent — either via an embedded relation or as a polymorphic variant.

### Model (Entity)

A data description with unique identity and a lifecycle. Models appear in the contract's `models` section. Each model has one canonical storage location — either its own table/collection (aggregate root) or inside another model's storage (embedded). The distinction from value types is identity: two Posts with the same title are still different Posts.

### Value Type (Composite)

A named field structure with no identity. Two instances with the same field values are interchangeable — an Address defined by street/city/state has no separate identity beyond its content. Value types are a future concept in the contract (a `types`/`composites` section); currently they're represented as models with empty storage.

> **Status:** Not yet implemented in the contract. Tracked as an open question.

### Relation Strategy

How a relation between two models is persisted. Each relation in the contract declares one of two strategies:

- **`reference`** — the related model lives in its own storage unit (table or collection). Resolved at query time via JOIN (SQL) or `$lookup` / application-level stitching (MongoDB).
- **`embed`** — the related model is nested inside the parent's document (MongoDB) or JSON column (SQL). No join needed; the data comes back in the same read.

Embedding is a property of the *relation*, not the model. The same model can be embedded in one parent and referenced from another.

### Discriminator

The field on a base model that distinguishes between variant shapes in a polymorphic model. The contract records the field name and the possible values: e.g., `"discriminator": { "field": "type" }` with variants mapping to values like `"bug"`, `"feature"`.

### Variant

A specialized model distinguished by a discriminator value. Variants appear as sibling models in the contract's `models` section, each with a `base` property pointing back to the base model. Variants carry only their type-specific fields; shared fields live on the base.

### Base (Model)

The model that a variant specializes. Chosen over "parent" or "superclass" to describe a structural relationship without implying OOP inheritance semantics. The contract says "Bug's base is Task" — a domain fact about the data, not a statement about class hierarchies.

### Specialization / Generalization

The terminology used instead of "inheritance" or "subclassing" for polymorphic models. A variant *specializes* a base model (adds type-specific fields). A base model *generalizes* its variants (captures shared structure). This framing describes data relationships without OOP baggage.

---

## Contract Structure

### Domain / Storage Separation

The contract's two-layer design. The domain layer (`roots`, `models` with `fields`/`relations`/`discriminator`/`variants`) describes what the application models. The storage layer (`model.storage`, top-level `storage`) describes how things persist. The domain structure is family-agnostic; family-specific details are scoped to storage. See [ADR 172](architecture%20docs/adrs/ADR%20172%20-%20Contract%20domain-storage%20separation.md).

### ContractBase

The shared domain-level contract type consumed by family-agnostic code (ORM clients, validation, tooling). Contains `roots`, `models` (with fields, relations, discriminator/variants). Family-specific contracts (`SqlContract`, `MongoContract`) extend it with their own storage types.

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

### Collection

The primary ORM abstraction for querying a model. Each aggregate root gets a `Collection` instance (e.g., `db.users` is a `Collection<Contract, 'User'>`). Collections use immutable fluent chaining — each method call (`.where()`, `.include()`, `.take()`) returns a new Collection with accumulated state. Nothing executes until a terminal method (`.all()`, `.first()`) compiles the state into a family-specific query plan. The Collection interface is shared across families; only the terminal compilation differs. See [ADR 175](architecture%20docs/adrs/ADR%20175%20-%20Shared%20ORM%20Collection%20interface.md).

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
| query builder             | query lane / lane                   | Architecture docs, package names, internal naming                 | Pending |


