# May Milestone: Early Access (for users)

**Goal**: Users can pick up Prisma Next for Postgres, SQLite, or MongoDB and build a real application without hitting roadblocks. Validate this by porting real applications ourselves. Early feedback from users identifies feature gaps, finds bugs, tests the value proposition, and builds support for Prisma Postgres.

**Non-goals**:

- Upgrade path from Prisma 7
- Complete feature parity with Prisma 7
- Production-readiness certification

---

## Approach: user validation through representative apps

April proved the architecture. May proves the product. The primary forcing function is porting real applications to Prisma Next — each port exercises the full stack (authoring, emit, migrate, query, debug) and surfaces the gaps that unit tests and architectural PoCs miss.

The team has four people and 4–5 weeks. One person acts as a **full-stack scout** — porting real apps, defining the public API surface, and fixing gaps autonomously. The remaining people work parallel workstreams addressing known gaps and incoming discoveries. Workstreams beyond the team size are queued and picked up as earlier ones complete or as people become available.

The full-stack scout is not a passive reporter. They have autonomy to address issues they find directly, collaborating with workstream owners to avoid conflicts when the fix touches workstream-owned territory. They are the closest thing to a real user the team has — their friction is the team's signal.

Building the apps is not the hard part. Addressing the limitations they uncover is. The apps are the discovery mechanism; the workstreams are where the real work happens.

---

## WS1: App porting + public API

**People**: 1

The scout. Ports real applications to Prisma Next, defines the public API surface (facade packages), and fixes issues autonomously.

**Context**: Today, `@prisma-next/postgres` and `@prisma-next/sqlite` exist as facade packages with a single `./runtime` export. `@prisma-next/mongo` doesn't exist yet. The ~30 internal packages are not something we want to expose to users. The facade packages are the natural place to express the public API — what users import, what's stable, what's documented.

**Key risks**:

- The import surface is too complex or requires too many packages for a simple app
- Real-world schemas expose ORM, query builder, or migration gaps that block adoption
- The side-by-side story with Prisma 7 doesn't work in practice

#### Prerequisite: `init` command and Mongo facade

Before porting apps, verify the onboarding path works. The `init` command (scaffolding config, contract, and scripts for a new project) is the first thing a new user runs. If it doesn't exist or is incomplete, implement it. Additionally, create `@prisma-next/mongo` facade package with the same structure as `@prisma-next/postgres` and `@prisma-next/sqlite`.

#### Milestone 1: Management API — reads

Port the Prisma Data Platform Management API's read endpoints to Prisma Next, running side by side with the existing Prisma 7 implementation. This is the gentlest forcing function — read queries against an existing database, no migrations, no writes.

Tasks:

1. **Author the PDP contract in PSL** — model the Management API's schema in Prisma Next PSL, emit the contract, and verify the output is correct against the live database. Produce a PSL parity audit as a side-effect, classifying each gap encountered as `greenfield-blocker`, `defer-to-june`, or `worked-around-for-EA`. The audit is the input to WS5.
2. **Port read API endpoints** — replace Prisma 7 queries with Prisma Next ORM queries for all `get` and `list` operations. Use the SQL DSL as an escape hatch where the ORM can't express the query.
3. **Define the facade surface** — based on what you actually needed to import, define the public API for `@prisma-next/postgres`. Document what's exposed and what's internal.

Checkpoint: All `get` and `list` operations in the Management API use Prisma Next exclusively. Prisma 7 is not used for any read operation. The `@prisma-next/postgres` facade surface is defined and documented.

#### Milestone 2: Management API — writes

Extend the port to include write operations and transactions.

Tasks:

1. **Port write endpoints** — replace Prisma 7 mutations with Prisma Next ORM mutations for all write operations (creates, updates, deletes).
2. **Transaction usage** — use transactions (built by WS2) in at least one multi-step business logic unit. Exercise ORM + SQL DSL interop within a transaction.

Checkpoint: All write operations in the Management API use Prisma Next exclusively. At least one transactional workflow is ported and running. ORM and SQL DSL gaps discovered during the port are filed for WS2.

#### Milestone 3: PDP schema management via PN migrations

Port the PDP's database schema management from Prisma 7 migrations to Prisma Next migrations. This is the first real-world exercise of the migration workflow.

Tasks:

1. **Initial migration** — create the initial migration that represents the current PDP schema. Verify `migration apply` produces the correct tables against a fresh database.
2. **Schema evolution** — make a schema change (add a model, add a field, add a relation), plan and apply the migration. Exercise the planner on common scenarios.
3. **Escape hatch** — hit a case the planner can't handle (or simulate one). Author a manual migration. Verify it integrates cleanly into the graph.
4. **Feedback to WS3** — file detailed UX feedback on every rough edge: confusing output, unclear errors, missing information, workflow friction.

Checkpoint: The PDP database schema is managed exclusively by Prisma Next migrations. At least one planned migration and one manual migration have been applied. Detailed migration UX feedback is filed for WS3.

#### Milestone 4: Cal.com adoption path

Validate that an external, large-scale Next.js application can adopt Prisma Next. Cal.com is open source, has a large Prisma 7 schema, and runs on Next.js — it's a representative target for the EA audience.

Tasks:

1. **Contract authoring** — author a contract for Cal.com's schema (or a representative subset). Note any schema features that can't be expressed; greenfield-shaped gaps feed WS5, brownfield-shaped gaps (P7→PN syntax) feed the June milestone draft.
2. **Side-by-side setup** — configure PN alongside P7 in the Cal.com codebase. Verify the two can coexist without conflicts.
3. **Basic query port** — port a small number of queries to PN. Exercise both ORM and SQL DSL.
4. **Document the adoption path** — write up what worked, what didn't, and what a Cal.com developer would need to know. Hand off to DevRel.

Checkpoint: A written assessment of the Cal.com adoption path exists, with concrete evidence (working queries or documented blockers). A Cal.com developer could follow the documented path without our help. This is an evaluation, not a full port.

---

## WS2: Transactions + query surface

**People**: 1

The query surface is how users interact with their data. Transactions don't exist today. The SQL query builder is PoC-level. The ORM has gaps that will be discovered by WS1 and WS4. This workstream makes the query surface real.

**Key risks**:

- Transaction semantics are complex and interact with connection pooling, error handling, and the adapter abstraction
- The SQL query builder needs to graduate from PoC to something users can rely on as an ORM escape hatch
- ORM gaps may require structural changes, not just additive features
- The MongoDB ORM may have feature parity gaps compared to the SQL ORM that surface during WS1 or WS4 — monitor and address if they arise

#### Milestone 1: Transactions end-to-end

April validated that transactions are architecturally feasible. May makes them work.

Tasks:

1. **ORM transaction support** — `db.$transaction(async (tx) => { ... })` with commit on success, rollback on error.
2. **SQL DSL within transactions** — the SQL DSL can execute queries within an ORM-opened transaction, sharing the same connection.
3. **Error handling** — errors inside a transaction trigger rollback and propagate to the caller with a clear error envelope.
4. **Multi-target** — transactions work on Postgres, SQLite, and MongoDB (where supported by the database).

Checkpoint: A transaction opens, executes two ORM mutations and a SQL DSL query sharing the same connection, and commits. An error inside a transaction triggers rollback and propagates cleanly. Works on Postgres and SQLite at minimum.

#### Milestone 2: SQL query builder maturity

The SQL DSL is the escape hatch for the ORM. It needs to cover the queries that real applications need but the ORM can't express.

Tasks:

1. **Audit against real-world query patterns** — review the Management API's queries (from WS1) and common SQL patterns. Identify what the builder can't express today.
2. **Implement missing query operations** — prioritized by what WS1 actually needs, then by common SQL patterns.
3. **Multi-target SQL generation** — verify that the builder produces correct SQL for both Postgres and SQLite (different quoting, function names, type handling).

Checkpoint: The SQL DSL can express every query the Management API port (WS1) needs. Common patterns — joins, aggregations, subqueries — produce correct, parameterized SQL on both Postgres and SQLite.

#### Milestone 3: ORM gap fixes

Address ORM gaps discovered by WS1 (app porting) and WS4 (test harness). The specific gaps aren't known yet — this is reactive work driven by incoming discoveries.

Checkpoint: No ORM gaps are blocking WS1's progress. The test harness (WS4) exercises ORM scenarios across all three targets without failures caused by ORM bugs.

---

## WS3: Migrations maturity

**People**: 1

The migration system's architecture is validated (April). The workflow is not. Nobody has used `migration plan → apply → status` to manage a real database. The planner covers limited scenarios. The escape hatch (manual migration authoring) is a PoC. CI/CD integration is untested. If the migration workflow isn't intuitive, it will destroy trust at EA — migrations are the highest-stakes developer workflow.

**Key risks**:

- The escape hatch is the critical path. The planner won't cover every scenario, and users will need to author migrations by hand. If this feels clunky, the entire migration system fails regardless of how good the planner is.
- Predictability is trust. Users must be able to trivially answer "what migrations will run when I push this." Any surprises will erode confidence instantly.
- Preflight verification may be necessary. Prisma 7's shadow database catches migration errors before they hit production. We need an equivalent confidence mechanism.

#### Milestone 1: Escape hatch UX

The planner can't cover every schema change. When it can't, the user authors a migration manually. This must feel natural — not like an emergency procedure.

Tasks:

1. **Refine the scaffold command** — the scaffold command (currently `migration new` or equivalent) produces a migration file with the correct graph coordinates pre-populated. The user writes their logic and it just works.
2. **Manual migration for common unsupported cases** — test against the cases the planner can't handle today. The manual path must cover them seamlessly.
3. **Graph integration** — manual migrations are indistinguishable from planner-generated migrations in the graph. `plan`, `apply`, `status` treat them identically.

Checkpoint: A developer scaffolds a manual migration for a case the planner doesn't support, writes the migration logic, and applies it. The manual migration is a first-class graph node — `plan`, `apply`, and `status` treat it identically to planner-generated migrations. The workflow feels natural, not like an escape hatch.

#### Milestone 2: Workflow UX + predictability

The full migration loop — change schema, plan, review, apply, verify — must produce clear, helpful output at every step. The user must always know what will happen next.

Tasks:

1. **`migration plan` output** — clear, human-readable summary of planned operations. The user can review and approve before applying.
2. **`migration status` output** — unambiguous answer to "where am I?" and "what will run next?" relative to the migration graph.
3. **`migration apply` output** — progress indication, success confirmation, and clear error messages on failure.
4. **Error diagnostics** — every migration error tells the user what went wrong and suggests a next step. No stack traces without context.
5. **`db verify` / `db sign` guidance** — ensure the workflow for verifying contracts against live databases and signing them for production is documented and produces clear output. These commands exist but their place in the user workflow needs to be made obvious.

Checkpoint: A developer runs the full migration loop (plan → review → apply → verify) and always understands what's happening. "What migrations will run when I push this to production?" is trivially answerable from the CLI output.

#### Milestone 3: Migration preflight

Users need confidence that a migration will succeed before running it against production. Prisma 7's shadow database provides this. We need an equivalent mechanism.

Tasks:

1. **Design the preflight mechanism** — decide on the approach (shadow database, dry-run mode, test database verification, or something simpler). The mechanism must work in both local development and CI.
2. **Implement preflight** — a command or flag that verifies migrations will apply cleanly without modifying the target database.
3. **CI integration** — preflight can run as a CI check that gates deployment.

Checkpoint: A developer verifies that pending migrations will apply cleanly before deploying to production. The mechanism works locally and in CI. Migration failures are caught before they reach production.

#### Milestone 4: Planner coverage expansion

Once the workflow is solid, broaden the automatic planner to cover common migration scenarios — targeting at least Prisma 7 parity for typical cases.

Tasks:

1. **Audit P7 planner coverage** — identify the schema changes P7 handles automatically.
2. **Implement common cases** — add planner strategies for each common case, prioritized by frequency.
3. **Multi-target** — planner produces correct DDL for Postgres, SQLite, and MongoDB.

Checkpoint: The planner handles the common 80% of schema changes that Prisma 7 handles — add model, drop model, add field, drop field, rename field, add relation, change field type. Uncommon cases fall through to the escape hatch gracefully.

---

## WS4: Multi-target test harness

**People**: 1

Confidence in correctness across Postgres, SQLite, and MongoDB. Today's tests are per-target and ad hoc. A shared test suite exercising the same scenarios across all three targets catches family-specific bugs, ensures behavioral consistency, and prevents regressions.

**Key risks**:

- Behavioral differences between targets may be larger than expected (e.g. type coercion, NULL handling, transaction semantics)
- The test harness infrastructure itself is non-trivial — parameterizing tests across three different databases with different setup/teardown requirements

#### Milestone 1: Shared test suite infrastructure

Tasks:

1. **Test harness design** — parameterized test runner that takes a target configuration (connection, adapter, contract) and runs the same test suite against each target.
2. **Database lifecycle** — automated setup, migration, seeding, and teardown for each target's test database.
3. **Target configurations** — working configurations for Postgres, SQLite, and MongoDB.

Checkpoint: A single test file runs the same scenario against Postgres, SQLite, and MongoDB. Each target uses its own database instance and adapter. Failures are clearly attributed to a specific target. Database setup and teardown are fully automated.

#### Milestone 2: ORM scenario coverage

Exercise the ORM through representative scenarios across all three targets.

Tasks:

1. **CRUD operations** — create, read, update, delete across all targets.
2. **Relations and includes** — relation traversal, eager loading, nested queries.
3. **Filtering and ordering** — where clauses, sorting, pagination.
4. **Aggregations** — count, sum, avg, min, max, group by.
5. **Edge cases** — NULL handling, empty results, type coercion, large result sets.

Checkpoint: A comprehensive ORM scenario suite runs green on all three targets. Any failures are filed as bugs for WS2 with clear target attribution.

#### Milestone 3: Migration scenario coverage

Exercise the migration workflow across targets.

Tasks:

1. **Plan and apply common schema changes** — add model, add field, add relation, drop model, rename field.
2. **Manual migrations** — scaffold and apply a manual migration on each target.
3. **Data migrations** — run a data migration on each target.

Checkpoint: `migration plan`, `migration apply`, and `migration status` work correctly on Postgres, SQLite, and MongoDB for common schema change scenarios. Manual and data migrations integrate into the graph on all targets.

---

## WS5: PSL authoring for greenfield

**People**: queued (picked up when an earlier workstream completes; gated on WS1 M1 audit)

PSL is the primary authoring surface for the EA audience. A greenfield user picking up Prisma Next will write a `schema.prisma` for their domain — orgs, users, memberships, posts, tags, audit columns — and expect the language to handle the patterns they already know from any modern ORM. Today the SQL PSL provider has gaps that turn common greenfield patterns into roadblocks (native scalar arrays, composite primary keys, `@updatedAt`, inline `@db.X`).

**Scope is greenfield only.** This workstream does not own P7→PN upgrade syntax (`@ignore`, `@@schema`, implicit many-to-many, views, `Unsupported(...)` round-trip) — those are June concerns once the EA story is real. The acceptance test is "a typical SaaS skeleton authors cleanly in PSL without workarounds."

**Key risks**:

- Some gaps (native scalar arrays, composite PKs) require contract-IR and codec changes that ripple through emit, migrate, and ORM, not just the PSL layer. The work is wider than its name suggests.
- The list of "common greenfield patterns" can grow without bound. Without a tight bound, this workstream becomes "make PSL match Prisma 7" — exactly the June work we're deferring.
- Some changes (inline `@db.X`) interact with the printer's named-type strategy and risk producing inconsistent contracts on a `infer → edit → emit` round-trip.

#### Milestone 1: Greenfield gap inventory (gate)

The scout (WS1 M1) authors the Management API contract and produces the parity audit. This workstream picks up the `greenfield-blocker` set, prioritizes it against representative greenfield schemas, and cuts the list to what fits the available capacity.

Tasks:

1. **Reconcile the audit with greenfield exemplars** — cross-reference scout findings with at least two reference schemas: a SaaS skeleton (orgs, users, memberships, posts, tags, audit timestamps) and one public starter (e.g. T3-shaped Next.js app).
2. **Classify and cut** — confirm each item is greenfield-shaped and not P7-upgrade-shaped. Items that don't fit get explicitly listed in the June milestone doc rather than implicitly deferred.
3. **Document the in-scope set** — produce a short, ticket-backed plan covering at most two weeks of one engineer.

Checkpoint: A scoped, prioritized backlog of greenfield-blocker PSL gaps exists. Items deferred to June are explicitly captured in the June milestone draft.

#### Milestone 2: High-frequency authoring fixes

The non-negotiables for greenfield SaaS authoring. Each of these is something a competent backend engineer expects to "just work" on day one.

Tasks:

1. **Native scalar arrays** — `String[]`, `Int[]`, etc. lower to native Postgres arrays (`text[]`, `int4[]`) with their own codecs, not JSON. Mongo arrays already work natively. (TML-1909.)
2. **Composite primary keys (`@@id`)** — accept `@@id([col1, col2])` in the interpreter. Closes the printer↔interpreter asymmetry that breaks `contract infer` round-trip on any junction table.
3. **`@updatedAt`** — register as a built-in execution default that updates on every mutation. Wire through both SQL and Mongo ORM mutation paths.
4. **Inline `@db.X`** — accept native-type attributes directly on model fields (`email String @db.VarChar(255)`), or — if the named-type architecture makes that disruptive — emit an actionable diagnostic that produces a one-step fix-it suggestion pointing to the `types {}` alias.

Checkpoint: A SaaS skeleton schema (orgs, users, memberships with composite PK, posts with `tags String[]`, audit `createdAt`/`updatedAt` columns, `@db.Text` descriptions, `@db.VarChar` slugs) authors cleanly in PSL, emits a working contract, migrates onto a fresh Postgres database without manual edits, and round-trips through `contract infer` back to an equivalent PSL source.

#### Milestone 3: Authoring ergonomics

The remaining items the scout flagged that affect "first 30 minutes of use" but don't require the same depth of refactor.

Tasks:

1. **Diagnostic quality on rejected constructs** — every `PSL_UNSUPPORTED_*` diagnostic carries an explicit hint: what's not supported, why, and the recommended workaround (or "deferred to June, see <link>").
2. **Test-backed parity inventory** — replace ad-hoc product docs with a parity matrix derived from the diagnostic registry plus integration test fixtures, so it can't drift unnoticed. Owner can be DevRel later, but the source of truth is the codebase.
3. **TS-authoring spillover** — items the scout flags in TS authoring that overlap with the PSL gaps fixed in M2 are filed and addressed where they share a contract-IR change; otherwise queued for June.

Checkpoint: A first-time user opens the docs, sees the supported PSL surface and known limitations, authors a contract, and recovers gracefully from any limitation diagnostic.

---

## WS6: CLI + error consistency

**People**: queued (picked up when an earlier workstream completes)

The CLI is the primary interface for authoring, migration, and database management workflows. Consistent output formats, error messages, and return types across all commands build confidence. Inconsistency erodes it.

**Key risks**:

- Error messages today may be stack traces or raw exceptions rather than user-facing diagnostics
- Different commands may use different output formats, making the CLI feel like a collection of scripts rather than a cohesive tool

#### Milestone 1: Error envelope consistency

All CLI commands and runtime operations return errors in a consistent format with a stable error code, a human-readable message, and a suggested next step. This includes both CLI error output and runtime error envelopes returned by the query engine and adapters.

Tasks:

1. **Audit existing error paths** — catalog every CLI command and runtime operation's error output, including query engine and adapter errors. Identify inconsistencies.
2. **Define the error envelope** — stable error codes, human-readable messages, suggested remediation. Consistent across CLI and runtime (query errors, connection errors, constraint violations).
3. **Implement consistently** — update all commands and runtime error paths to use the standard envelope.

Checkpoint: All CLI commands and runtime operations produce errors in a consistent envelope: stable error code, human-readable message, suggested next step. No raw stack traces appear in user-facing output. Runtime query and adapter errors use the same envelope structure.

#### Milestone 2: CLI output consistency

All CLI commands use consistent formatting, progress indication, and output modes (human-readable default, machine-readable via flag).

Tasks:

1. **Output audit** — catalog formatting across all commands, including undocumented or orphan commands (e.g. `inspect-live-schema`, `contract-infer-paths`). Clean up or remove commands that don't belong in the public CLI.
2. **Standardize** — consistent headers, progress indicators, success/failure formatting.
3. **Machine-readable mode** — all commands support a `--json` (or equivalent) flag for programmatic consumption.

Checkpoint: All CLI commands share a consistent visual language — formatting, progress indication, success/failure presentation. Every command supports a machine-readable output mode.

#### Milestone 3: CI/CD integration

Migrations are a critical component of deployment pipelines. The CLI must work in automated environments without interactive prompts, with correct exit codes and machine-readable output.

Tasks:

1. **Non-interactive mode** — all migration commands work without interactive prompts in CI.
2. **Exit codes** — correct exit codes for success, failure, nothing-to-do, and error conditions.
3. **Machine-readable output** — JSON or structured output mode for CI tooling to parse.
4. **Pipeline testing** — exercise the full CI/CD flow: plan in CI, apply in CD, status as a gate.

Checkpoint: A CI/CD pipeline runs migration plan, preflight, and apply using the PN CLI. Exit codes are correct for automation. Machine-readable output is available for tooling. No interactive prompts block automated execution.

---

## WS7: Developer workflow commands

**People**: queued (picked up when an earlier workstream completes)

Not everyone uses migrations, especially during early development. `db update` ("just make my dev database match my schema") and `db init` ("set up a fresh database") are the non-migration workflow for day-to-day development. These commands are how greenfield developers get started and iterate quickly — they need to work reliably across all targets.

`contract infer` (introspect an existing database into a contract) already ships for SQL targets. Its greenfield round-trip parity (the patterns WS5 makes authorable must also be inferable cleanly so `db init → contract infer` produces an equivalent contract) is owned by WS5 as part of printer↔interpreter symmetry. Brownfield-specific pattern coverage (e.g. `@ignore` for unrepresentable columns, `@@schema`, implicit many-to-many inference, views, `Unsupported(...)` placeholders) is deferred to June.

**Key risks**:

- `db update` may fail on schema changes that the migration planner handles, confusing users about which tool to use when
- `db init` correctness is critical: a wrong fresh-database setup destroys trust before the user runs a single query

#### Milestone 1: `db update` and `db init` reliability

`db update` is the fast iteration tool for development. `db init` sets up a fresh database from a contract. Both must work reliably across all targets.

Tasks:

1. **`db update` coverage** — ensure `db update` handles common development-cycle schema changes (add field, add model, change type) cleanly.
2. **`db init` correctness** — verify `db init` creates a correct database from a contract on Postgres, SQLite, and MongoDB.
3. **Clear guidance on `db update` vs migrations** — when `db update` can't handle a change, the error should guide the user to use migrations instead.

Checkpoint: `db update` handles common development-cycle schema changes without errors on all three targets. `db init` creates a correct database on Postgres, SQLite, and MongoDB. When `db update` hits a case it can't handle, the error message directs the user to use migrations.

---

## Release

Publicly announce Early Access status of Prisma Next for Postgres, SQLite, and MongoDB. DevRel writes user-facing documentation with team assistance (getting-started guides, API reference, key concepts, migration guides from P7). The team provides:

- Defined public API surface (facade packages with documented exports)
- Working example applications (Management API port, demo apps)
- Documented adoption path for existing codebases (Cal.com assessment)
- Internal assessment of known gaps and limitations for the EA release notes
