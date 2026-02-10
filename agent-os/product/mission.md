# Product Mission

## Pitch

Prisma Next is an **agent‑first, contract‑first data access layer** that replaces the legacy Rust/TypeScript Prisma ORM with a fully TypeScript, modular core. It helps developers and AI coding assistants build verifiable, type‑safe database applications by emitting machine‑readable data contracts, compiling composable queries into explicit plans, and enforcing guardrails for safe schema evolution.

## Problems We Want to Solve

### Split Rust / TypeScript Codebase

- We can't continue to maintain a split Rust / TS ORM.
  - Issues in the Rust core surface faster than we can address them.
  - The mixed stack makes it hard for the community to contribute or extend behavior.
  - Adding new databases or capabilities requires deep changes across languages and layers.

### Non‑Extensible Core

- We want an extensible core instead of a monolith.
  - Each database and capability should be an independent extension pack, not hard‑wired into core.
  - Extensions should be published as NPM packages and composed at the edges, similar to ESLint plugins or ESBuild loaders.
  - New adapters, codecs, and operations should plug in declaratively via manifests and capability contracts.
  - Prisma Next follows a thin core, fat targets model: core defines contracts, plans, and runtime SPI; families, adapters, and packs implement dialects and capabilities on top.

### Incompatible with Native JS Environments

- We want Prisma to run cleanly in all native JS environments.
  - The current Rust implementation introduces deployment friction and hard‑to‑debug edge cases.
  - We want a TS‑through‑and‑through stack: ESM‑friendly, tree‑shakable packages that run wherever modern JS runs (Node, edge runtimes, serverless, workers).

### Opaque ORMs Break Agent Workflows

- Traditional ORMs like Prisma ORM use heavy code generation that hides SQL semantics behind generated methods. AI coding assistants can't reason about these opaque abstractions, leading to incorrect code generation and unpredictable runtime behavior.
- Prisma Next exposes data contracts as inspectable JSON artifacts and uses a composable DSL that AI agents can statically analyze, generate, and verify.

### Schema Drift and Unsafe Migrations

- Without verification mechanisms, database schemas diverge from application expectations and problems are often detected only in production.
- Prisma Next uses cryptographic contract hashing with runtime verification and database markers so both planes verify that code and schema agree before execution.

### Lack of Built‑In Guardrails

- Current ORMs lack built‑in policy enforcement, query budgets, or linting capabilities. Teams must build custom tooling to prevent dangerous operations like `SELECT *` or mutations without `WHERE` clauses.
- Prisma Next bakes guardrails into the architecture: lints, budgets, and policy plugins run at authoring, planning, preflight, and execution time.

## What is Prisma Next?

Prisma Next is an **audacious pivot of the Prisma ORM**:

- Fully TypeScript: a single, JS‑native implementation—no Rust core, no mixed‑language runtime.
- Modular and extensible: thin framework core plus target‑family packages (e.g., SQL) and adapter/driver packs; new databases and capabilities arrive as installable extensions, not core patches.
- Data Contract as the center of gravity: a canonical `contract.json` and `contract.d.ts` define schema, capabilities, and policies for both migration and query planes.
- Innovative migration model: contract‑to‑contract edges with preconditions, postconditions, and PPg‑backed preflight replace ad‑hoc migration scripts.
- Designed for verification and guardrails: every query and migration goes through explicit, machine‑readable plans, marker checks, and plugins for lints, budgets, and policy enforcement.
- Agent‑first by design: contracts, plans, and diagnostics are structured so AI coding assistants can statically analyze, generate, and evolve application code with tight feedback loops.

We have a working MVP and are targeting a public release aligned with the first SQL family and Postgres adapter.

## Users

### Primary Customers

- **Developer teams using AI assistants**: Teams leveraging AI coding tools (Cursor, Windsurf, v0.dev) who need deterministic, machine‑readable database tooling.
- **Enterprise development and platform teams**: Organizations requiring verifiable schema contracts, audit trails, and policy enforcement for database changes.
- **Community contributors and ecosystem partners**: Developers building extensions, database support, or maintaining Prisma Next.

### User Personas

**AI‑Assisted Developer**

- **Role:** Full‑stack developer using AI coding assistants.
- **Context:** Building modern web applications with frequent schema iterations and AI‑generated code.
- **Pain Points:** Traditional ORMs are opaque to AI assistants; hidden codegen creates unpredictable behavior; schema drift causes production issues.
- **Goals:** Write type‑safe queries that AI can understand and generate; catch schema issues before deployment; iterate quickly without regenerating clients.

**Platform Engineer**

- **Role:** Infrastructure/platform engineer building internal tools.
- **Context:** Managing database access patterns for multiple teams and services.
- **Pain Points:** No visibility into query patterns; can't enforce query budgets or policies; migrations lack verification and rollback safety.
- **Goals:** Implement guardrails for database operations; audit and control query behavior; enable safe, automated migrations.

**Technical Lead / Architect**

- **Role:** Engineering lead responsible for architecture and data integrity.
- **Context:** Overseeing multiple services with complex data models.
- **Pain Points:** Schema changes cause production incidents; no way to verify migrations before apply; monolithic ORM limits extensibility.
- **Goals:** Ensure schema changes are safe and verifiable; implement capability‑based feature gating; maintain audit trail of all schema changes.

## Differentiators

### Contract‑First Architecture

Unlike traditional ORMs that treat schemas as codegen fuel, Prisma Next defines schemas as verifiable contracts with cryptographic hashing. This enables drift detection, capability gating, and deterministic verification across environments. Both migration and query planes ingest the same `contract.json` and validate `storageHash` / `profileHash` against a database marker before acting.

### Machine‑Readable by Design

While other ORMs generate opaque runtime code, Prisma Next exposes structured IR (Intermediate Representation) as JSON that AI agents and tools can directly consume. Plans include AST, referenced columns, capability profiles, and contract hashes for full transparency.

### Composable DSL Instead of Generated Client

Unlike Prisma ORM's monolithic generated client, Prisma Next provides a runtime‑compiled query DSL and ORM lane. Queries are written inline, compiled to SQL ASTs on demand, and work across dialects without regeneration.

### Plugin‑Based Extensibility

While legacy ORMs require core patches for new features, Prisma Next uses extension packs and plugins. Capabilities like vector search or geospatial queries compose cleanly without touching core runtime. Adapters and drivers are multi‑plane packages with clean separation between shared, migration, and runtime entrypoints.

### Runtime Verification with Fast Feedback

Unlike other tools that discover schema issues in production, Prisma Next verifies contract hashes at runtime and provides preflight migration simulation via PPg, catching problems before they reach production. Guardrail plugins deliver lints, query budgets, and telemetry with immediate, actionable feedback.

## Key Features

### Core Features

- **Verifiable Data Contracts:** Schemas defined as cryptographic contracts with hash‑based verification for drift detection and compatibility guarantees.
- **Type‑Safe Query DSL:** Composable, runtime‑compiled query builder with full TypeScript inference and dialect‑agnostic design.
- **Contract Emission:** Lightweight build‑time generation of `contract.json` and `contract.d.ts` instead of heavy client codegen.
- **Runtime Verification:** Automatic contract hash validation against database markers before query execution.

### Collaboration Features

- **Machine‑Readable Artifacts:** Contract IR as consumable JSON for AI agents, tools, and observability platforms.
- **Modular Package Architecture:** Clean separation of concerns with composable packages for IR, SQL, runtime, and adapters.
- **Multi‑Dialect Support:** Target‑agnostic core with adapter pattern for Postgres, MySQL, SQLite without client regeneration.
- **Preflight Migration Simulation:** PPg integration for shadow database testing and EXPLAIN‑based verification before applying changes.

### Advanced Features

- **Extensible Plugin Framework:** Composable hooks for linting, budgets, telemetry, and policy enforcement at all lifecycle stages.
- **Extension Packs:** First‑class capability packs for vector search (pgvector), geospatial (PostGIS), and domain‑specific operations.
- **Query Plans as First‑Class Artifacts:** Immutable, hashable plans with full metadata for caching, auditing, and policy enforcement.
- **Capability‑Based Feature Gating:** Contract‑declared capabilities verified against database markers to ensure compatibility.
- **Audit Trail and Ledger:** Append‑only ledger of applied migrations with contract hashes for compliance and troubleshooting.

## Vision

Prisma Next evolves Prisma from a monolithic ORM into a **contract‑driven, agent‑first data platform**. By making contracts and plans the primary artifacts—and by moving to a fully TypeScript, extensible core—we enable developers and AI assistants to collaborate safely on database schemas, queries, and migrations with unprecedented transparency, control, and speed.
