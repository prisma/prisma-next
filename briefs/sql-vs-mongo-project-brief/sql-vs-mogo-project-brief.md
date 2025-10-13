Here’s a clear, incremental project brief for migrating your current Prisma Next prototype into a SQL-specific foundation so that a parallel Mongo (and future) target family can later be introduced cleanly.

⸻

Project Brief: SQL-Specific Refactor (Foundation for Multi-Target Support)

Objective

Restructure the current prototype so that all SQL-specific logic is isolated into dedicated packages.
The goal is to make SQL the first “target family” implementation—fully functional on its own—but with a neutral core architecture that allows future addition of *-mongo (and potentially other) families without breaking compatibility or introducing abstraction creep.

⸻

Motivation

Right now, the project blends SQL semantics into every layer—IR, planner, runtime, migrations.
That makes it impossible to introduce Mongo cleanly later without deep rewrites.
By explicitly refactoring now, we’ll:
	1.	Clarify ownership boundaries between core, SQL, and future targets.
	2.	Keep the runtime and migration protocols target-agnostic.
	3.	Enable separate release cadences per target (SQL stable first, Mongo experimental later).
	4.	Preserve developer ergonomics: SQL users won’t notice any change, while new Mongo users can later plug in parallel equivalents.

⸻

Final Structure

Root workspace layout (post-refactor)

packages/
  # Core shared libraries
  core/                     # hashing, canonical JSON, package I/O, CLI routing
  runtime-core/             # hook/plugin interfaces, Plan shape, execution protocol

  # SQL family (current code migrated here)
  relational-ir/             # IR: tables, columns, constraints
  sql/                       # Query DSL & AST → SQL compiler
  runtime-sql/               # DatabaseConnection, AdminConnection, plugin impls
  migrate-sql/               # opset types, lowerer → DDL script, runner
  planner-sql/               # A→B planner (MVP)
  orm-sql/                   # ORM DSL & relation lowering
  ddl-script/                # SQL DDL AST & compiler (shared among SQL dialects)

  # Mongo family (placeholder for future work)
  document-ir/
  mongo/
  runtime-mongo/
  migrate-mongo/
  planner-mongo/
  orm-mongo/


⸻

Migration Plan

Phase 1 — Identify and extract SQL dependencies

Goal: move every SQL-specific symbol, type, or dependency out of @prisma/runtime and @prisma/core.

Tasks:
	•	Audit imports for pg, SQL keywords, and relational concepts (columns, indexes, foreignKeys, etc.).
	•	Move all SQL logic into new runtime-sql package.
	•	Create runtime-core for:
	•	Plan type and minimal execution protocol (executePlan(plan: Plan): Promise<Result>).
	•	Hook plugin interfaces (beforeExecute, afterExecute, onError).
	•	Shared error classes (ContractMismatchError, DriftDetectedError, etc.).
	•	Update all packages to depend only on runtime-core for common interfaces.

Deliverable:
runtime-core becomes target-agnostic; runtime-sql provides SQL executor implementation.

⸻

Phase 2 — Relational IR isolation

Goal: make relational-ir self-contained and unambiguously SQL-specific.

Tasks:
	•	Rename packages/relational-ir to packages/ir-sql.
	•	Add target: 'postgres' | 'mysql' | 'sqlite' field to its schema.
	•	Move all constraint and column types under ir-sql/src/types/.
	•	Strip out any type-system shims that might later be Mongo-incompatible (e.g., column default kinds).

Deliverable:
ir-sql can be swapped out later for a parallel document-ir.

⸻

Phase 3 — CLI and core decoupling

Goal: make the CLI delegate to target-specific subcommands.

Tasks:
	•	Create packages/core with:
	•	Hashing utils
	•	Canonical JSON serializer
	•	Package loader/validator for { meta.json, opset.json }
	•	CLI router that reads contract.target → loads migrate-${target} or runtime-${target}
	•	Implement CLI command registry:

prisma-next migrate plan   # dispatches to migrate-sql
prisma-next migrate apply  # dispatches to runtime-sql


	•	Refactor current CLI entrypoints to go through core.

Deliverable:
A single @prisma/core CLI handles all targets transparently.

⸻

Phase 4 — Rename existing packages to SQL family

Goal: communicate target specificity explicitly in naming.

Renames:

Old package	New package
@prisma/relational-ir	@prisma/ir-sql
@prisma/sql	@prisma/sql (kept)
@prisma/runtime	@prisma/runtime-sql
@prisma/migrate	@prisma/migrate-sql
@prisma/planner	@prisma/planner-sql
@prisma/orm	@prisma/orm-sql

Tasks:
	•	Update all internal imports.
	•	Update tests and fixtures.
	•	Verify CLI command behavior unchanged.

Deliverable:
The project builds and passes all tests with renamed packages.

⸻

Phase 5 — Introduce target registry

Goal: make targets first-class citizens so new ones can register easily.

Create packages/core/src/targets.ts:

export interface TargetProvider {
  name: 'postgres' | 'mysql' | 'mongo';
  runtime: typeof import('@prisma/runtime-sql');
  migrate: typeof import('@prisma/migrate-sql');
  planner: typeof import('@prisma/planner-sql');
  orm?: typeof import('@prisma/orm-sql');
}

export const targets: Record<string, TargetProvider> = {
  postgres: {
    name: 'postgres',
    runtime: require('@prisma/runtime-sql'),
    migrate: require('@prisma/migrate-sql'),
    planner: require('@prisma/planner-sql'),
    orm: require('@prisma/orm-sql'),
  },
};

Later, the Mongo stack simply adds another entry.

Deliverable:
CLI and runtime can dynamically resolve by contract.target.

⸻

Phase 6 — Validation & Documentation

Goal: ensure nothing functional changed for SQL users but the structure supports new targets.

Tasks:
	•	Regression test all existing SQL functionality.
	•	Add smoke test that loading a Mongo target yields a “not implemented” error (to prove dispatch works).
	•	Document the new architecture in docs/architecture/targets.md.

⸻

Deliverables
	•	runtime-core (target-agnostic execution protocol)
	•	ir-sql, runtime-sql, migrate-sql, planner-sql
	•	core CLI router and target registry
	•	All tests green and SQL behavior unchanged
	•	Documentation:
	•	targets.md (architecture overview)
	•	adding-a-target.md (for future Mongo devs)

⸻

Future Work (Mongo)

Once the split is complete, adding Mongo means:
	1.	Implement document-ir
	2.	Add migrate-mongo, planner-mongo, runtime-mongo
	3.	Register in targets.ts
	4.	Implement a minimal DSL and AdminConnection
	5.	Extend CLI auto-dispatch

Each of those becomes a self-contained milestone without touching SQL code again.

⸻

Success Criteria
	•	SQL stack continues to run all existing examples/tests unmodified.
	•	Core/CLI can load and dispatch based on contract.target.
	•	No SQL-specific code remains in core packages.
	•	Adding targets.mongo later requires only additive work, not refactors.


