# Product Mission

## Pitch
Prisma Next is a contract-first data access layer that helps developers and AI coding assistants build type-safe database applications by providing verifiable contracts, composable queries, and built-in guardrails for safe schema evolution.

## Users

### Primary Customers
- **Developer Teams using AI Assistants**: Teams leveraging AI coding tools (Cursor, Windsurf, v0.dev) who need deterministic, machine-readable database tooling
- **Enterprise Development Teams**: Organizations requiring verifiable schema contracts, audit trails, and policy enforcement for database changes
- **Community Contributors**: Developers building extensions, database support or maintaining Prisma Next

### User Personas

**AI-Assisted Developer** (25-40 years)
- **Role:** Full-stack developer using AI coding assistants
- **Context:** Building modern web applications with frequent schema iterations and AI-generated code
- **Pain Points:** Traditional ORMs are opaque to AI assistants; hidden codegen creates unpredictable behavior; schema drift causes production issues
- **Goals:** Write type-safe queries that AI can understand and generate; catch schema issues before deployment; iterate quickly without regenerating clients

**Platform Engineer** (30-45 years)
- **Role:** Infrastructure/Platform engineer building internal tools
- **Context:** Managing database access patterns for multiple teams and services
- **Pain Points:** No visibility into query patterns; can't enforce query budgets or policies; migrations lack verification and rollback safety
- **Goals:** Implement guardrails for database operations; audit and control query behavior; enable safe, automated migrations

**Technical Lead** (35-50 years)
- **Role:** Engineering lead responsible for architecture and data integrity
- **Context:** Overseeing multiple services with complex data models
- **Pain Points:** Schema changes cause production incidents; no way to verify migrations before apply; monolithic ORM limits extensibility
- **Goals:** Ensure schema changes are safe and verifiable; implement capability-based feature gating; maintain audit trail of all schema changes

## The Problem

### Opaque ORMs Break Agent Workflows
Traditional ORMs like Prisma ORM use heavy code generation that hides SQL semantics behind generated methods. AI coding assistants can't reason about these opaque abstractions, leading to incorrect code generation and unpredictable runtime behavior.

**Our Solution:** Prisma Next exposes data contracts as inspectable JSON artifacts and uses a composable DSL that AI agents can statically analyze, generate, and verify.

### Schema Drift Creates Production Incidents
Without verification mechanisms, database schemas diverge from application expectations. Developers discover drift only after deployment failures, causing costly production incidents.

**Our Solution:** Cryptographic contract hashing with runtime verification detects drift before queries execute. Contract markers in the database ensure schema-code compatibility.

### No Guardrails for Database Operations
Current ORMs lack built-in policy enforcement, query budgets, or linting capabilities. Teams must build custom tooling to prevent dangerous operations like SELECT * or mutations without WHERE clauses.

**Our Solution:** Extensible plugin framework with composable guardrails (lints, budgets, telemetry) that enforce policies at authoring, planning, and execution time.

### Migration Systems Lack Safety and Auditability
Sequential migration scripts don't verify outcomes or maintain audit trails. Failed migrations leave databases in inconsistent states with no clear recovery path.

**Our Solution:** Contract-based migrations with preconditions, postconditions, and idempotent operations. PPg (Prisma Postgres) provides preflight verification and append-only ledger for audit trails.

## Differentiators

### Contract-First Architecture
Unlike traditional ORMs that treat schemas as codegen fuel, Prisma Next defines schemas as verifiable contracts with cryptographic hashing. This enables drift detection, capability gating, and deterministic verification across environments.

### Machine-Readable by Design
While other ORMs generate opaque runtime code, Prisma Next exposes structured IR (Intermediate Representation) as JSON that AI agents and tools can directly consume. Plans include AST, referenced columns, and contract hashes for full transparency.

### Composable DSL Instead of Generated Client
Unlike Prisma ORM's monolithic generated client, Prisma Next provides a runtime-compiled query DSL. Queries are written inline, compiled to SQL ASTs on demand, and work across dialects without regeneration.

### Plugin-Based Extensibility
While legacy ORMs require core patches for new features, Prisma Next uses extension packs and plugins. Capabilities like vector search or geospatial queries compose cleanly without touching core runtime.

### Runtime Verification with Fast Feedback
Unlike other tools that discover schema issues in production, Prisma Next verifies contract hashes at runtime and provides preflight migration simulation via PPg, catching problems before they reach production.

## Key Features

### Core Features
- **Verifiable Data Contracts:** Schemas defined as cryptographic contracts with hash-based verification for drift detection and compatibility guarantees
- **Type-Safe Query DSL:** Composable, runtime-compiled query builder with full TypeScript inference and dialect-agnostic design
- **Contract Emission:** Lightweight build-time generation of contract.json and contract.d.ts instead of heavy client codegen
- **Runtime Verification:** Automatic contract hash validation against database markers before query execution

### Collaboration Features
- **Machine-Readable Artifacts:** Contract IR as consumable JSON for AI agents, tools, and observability platforms
- **Modular Package Architecture:** Clean separation of concerns with composable packages for IR, SQL, runtime, and adapters
- **Multi-Dialect Support:** Target-agnostic core with adapter pattern for Postgres, MySQL, SQLite without client regeneration
- **Preflight Migration Simulation:** PPg integration for shadow database testing and EXPLAIN-based verification before applying changes

### Advanced Features
- **Extensible Plugin Framework:** Composable hooks for linting, budgets, telemetry, and policy enforcement at all lifecycle stages
- **Extension Packs:** First-class capability packs for vector search (pgvector), geospatial (PostGIS), and domain-specific operations
- **Query Plans as First-Class Artifacts:** Immutable, hashable plans with full metadata for caching, auditing, and policy enforcement
- **Capability-Based Feature Gating:** Contract-declared capabilities verified against database markers to ensure compatibility
- **Audit Trail and Ledger:** Append-only ledger of applied migrations with contract hashes for compliance and troubleshooting
