# Tech Stack

## Language & Runtime
- **Language:** TypeScript 5.9+
- **Runtime:** Node.js >= 20
- **Package Manager:** pnpm 10.x (with workspaces)
- **Module System:** ESM (ES Modules)

## Core Architecture

### Monorepo Management
- **Build System:** Turbo (turborepo) for task orchestration and caching
- **Workspace Management:** pnpm workspaces for monorepo package management
- **Workspace Structure:** Framework domain, SQL family domain, targets, extensions

### Schema & Type System
- **Schema Language:** PSL (Prisma Schema Language) - parsed via `@prisma-next/psl-parser`
- **Contract Format:** JSON with TypeScript definitions (contract.json + contract.d.ts)
- **Validation:** Arktype for runtime validation with `.infer` type extraction
- **Type Generation:** Custom TypeScript emitter producing lightweight types (not executable client)
- **Hashing:** SHA-256 for contract verification (storageHash + optional executionHash + profileHash)

### Package Architecture

#### Framework Domain (Target-Agnostic)
- **`@prisma-next/contract`** - Core contract types and JSON schema
- **`@prisma-next/plan`** - Plan model, diagnostics, and error taxonomy
- **`@prisma-next/operations`** - Target-neutral operation registry
- **`@prisma-next/contract-authoring`** - Base contract builders and canonicalization
- **`@prisma-next/contract-ts`** - TypeScript contract authoring surface
- **`@prisma-next/psl-parser`** - PSL parser and contract emission
- **`@prisma-next/cli`** - Framework CLI (family-agnostic, config-driven)
- **`@prisma-next/emitter`** - Contract emission engine with family hooks
- **`@prisma-next/runtime-executor`** - Target-agnostic execution engine with plugin lifecycle
- **`@prisma-next/core-control-plane`** - Migration plane core types and interfaces
- **`@prisma-next/core-execution-plane`** - Runtime plane core types and interfaces

#### SQL Family Domain
- **`@prisma-next/sql-contract`** - SQL-specific contract types (SqlContract, SqlStorage, SqlMappings)
- **`@prisma-next/sql-schema-ir`** - SQL schema intermediate representation
- **`@prisma-next/sql-operations`** - SQL operation definitions and assembly
- **`@prisma-next/sql-contract-ts`** - SQL TypeScript authoring builders
- **`@prisma-next/sql-contract-emitter`** - SQL emitter hook implementation
- **`@prisma-next/family-sql`** - SQL family descriptor with control/runtime entrypoints
- **`@prisma-next/sql-relational-core`** - Schema and column builders, operation attachment
- **`@prisma-next/sql-lane`** - Relational DSL and raw SQL helpers
- **`@prisma-next/sql-orm-lane`** - ORM builder compiling to SQL lane primitives
- **`@prisma-next/sql-runtime`** - SQL runtime implementing executor SPI

#### Targets & Adapters
- **`@prisma-next/targets-postgres`** - PostgreSQL target descriptor
- **`@prisma-next/adapter-postgres`** - PostgreSQL adapter (multi-plane: shared, control, runtime)
- **`@prisma-next/driver-postgres`** - PostgreSQL driver (pg/node-postgres wrapper)

#### Extensions
- **`@prisma-next/extension-pgvector`** - pgvector extension pack (vector types, ops, codecs)

#### Test Packages
- **`@prisma-next/integration-tests`** - Cross-package integration tests
- **`@prisma-next/e2e-tests`** - End-to-end CLI and runtime tests
- **`@prisma-next/test-utils`** - Shared test utilities

## Database Support

### Primary Database
- **Database:** PostgreSQL 15+
- **Connection Driver:** pg (node-postgres)
- **Protocol:** PostgreSQL wire protocol
- **Connection Pooling:** Native pg pooling

### Database Features
- **Contract Marker:** Database table storing storageHash and profileHash
- **Migration Ledger:** Append-only table recording applied migration edges
- **Advisory Locks:** Used during migration apply for concurrency control
- **Capability Discovery:** Runtime queries for database capabilities

## Development Tools

### Code Quality
- **Linting & Formatting:** Biome (unified linter + formatter, replaces ESLint + Prettier)
- **Type Checking:** TypeScript strict mode with composite projects
- **Dependency Validation:** dependency-cruiser for import graph validation
- **Architecture Enforcement:** Custom import validation via architecture.config.json

### Testing
- **Test Framework:** Vitest 2.1+ (ESM-native)
- **Coverage:** @vitest/coverage-v8 v4 for code coverage
- **Test Organization:** Single-threaded execution for database tests
- **Integration Tests:** Real PostgreSQL in Docker
- **E2E Tests:** Full CLI workflow tests with contract emission and migration

### Version Control & CI/CD
- **Git Hooks:** Husky for pre-commit validation
- **Staged Files:** lint-staged for focused linting on changed files
- **CI/CD:** GitHub Actions with parallel jobs
- **Changesets:** @changesets/cli for version management and changelogs
- **CI Jobs:** typecheck, lint, build, test, e2e, coverage

## Developer Experience

### Local Development
- **Build Mode:** Turbo dev mode with watch and incremental compilation
- **Hot Reload:** TypeScript incremental builds with tsconfig references
- **Config Management:** prisma-next.config.ts with Arktype validation
- **Contract Emission:** CLI-based or Vite plugin for auto-emit

### Documentation Standards
- **Architecture Docs:** Markdown with Mermaid diagrams in docs/architecture docs/
- **ADRs:** Architecture Decision Records (140+ ADRs documenting key decisions)
- **Package READMEs:** Standardized documentation per package
- **Code Comments:** Links to canonical ADRs over inline explanations

## Runtime Architecture

### Query Execution
- **Plan Model:** Immutable plans with SQL, params, and metadata (ADR 002, ADR 011)
- **Result Streaming:** AsyncIterable<Row> by default (ADR 124, ADR 125)
- **Execution Modes:** Buffer vs streaming based on adapter capabilities
- **Type Safety:** Column-based API with full TypeScript inference

### Telemetry & Observability
- **Metrics:** Plugin-based telemetry collection
- **Tracing:** Plan metadata includes storageHash, lane, refs, and annotations
- **Logging:** Machine-readable structured logs with stable error codes
- **Error Taxonomy:** Categorized errors (PLAN/RUNTIME/ADAPTER/BUDGET/LINT/MIGRATION/CONTRACT)

### Guardrails
- **Lint Rules:** Configurable rules (no-select-star, mutation-requires-where, no-missing-limit)
- **Query Budgets:** Row count, latency, and memory limits per environment
- **Policy Enforcement:** Environment-specific policies (dev lenient, prod strict)
- **Preflight Checks:** Optional EXPLAIN-based cost estimation

## Extension Ecosystem

### Extension Packs
- **Vector Search:** `@prisma-next/extension-pgvector` (MVP)
- **Geospatial:** PostGIS support (planned)
- **Custom Codecs:** Branded types with encode/decode logic
- **Pack Manifest:** JSON-based capability and operation declarations

### Plugin Framework
- **Lifecycle Hooks:** beforeCompile, afterExecute, onError
- **Plugin Composition:** Chaining with priority ordering
- **Built-in Plugins:** lint, budgets, telemetry
- **Distribution:** npm packages for third-party plugins

## Migration System

### Contract-Based Migrations
- **Edge Model:** Migrations as contract→contract edges with fromHash/toHash
- **Operations:** Declarative DDL operations (add/drop/alter table/column)
- **Idempotency:** Operation-level idempotency classification and enforcement
- **Preconditions/Postconditions:** Validation checks before and after migration

### Prisma Postgres (PPg)
- **Preflight Service:** Shadow database simulation for migration testing
- **Contract Ledger:** Centralized history of all contract versions
- **Drift Detection:** Runtime verification of contract markers
- **Advisory Integration:** Policy recommendations for schema changes

## Target Compatibility

### Current Support
- **PostgreSQL:** Full adapter with comprehensive capability support

### Planned Support
- **MySQL:** Adapter and driver implementation planned
- **SQLite:** Adapter planned for embedded use cases
- **MongoDB:** Document family adapter (community-driven)

## Build & Distribution

### Package Format
- **Module Format:** ESM with explicit .js extensions
- **Entry Points:** Multiple exports per package via subpath exports
- **Tree-Shaking:** Side-effect-free packages with curated exports
- **Source Maps:** Included for debugging
- **Type Definitions:** Distributed alongside JavaScript

### Build Tools
- **Compiler:** TypeScript 5.9+ with composite projects
- **Bundler:** tsdown for package builds
- **Optimization:** Turbo for build caching and parallelization
