# MongoDB in Prisma Next

## Why MongoDB?

Prisma Next's architecture was built for SQL. Every interface a consumer touches today — contracts, query plans, plugins, the ORM client — assumes a relational database with SQL as its query language. But PN's ambition is broader: a contract-first data layer that works across database families.

MongoDB is the test case. If PN can support MongoDB without breaking its core abstractions, the architecture generalizes. If it can't, we'd rather discover that now — before stabilizing interfaces for external contributors — than after.

MongoDB is also a strategic target. The [MongoDB engineering team's feature gap analysis](references/Prisma_MongoDB_%20Feature%20support%20priority%20list%20-%20Sheet1.csv) and [user journey](references/MongoDB-Prisma_%20User%20journey%20&%20Feature%20gaps.md) show that Prisma ORM's current Mongo support has significant gaps: no embedded document support, polymorphic fields fall back to untyped `Json`, no change streams, no aggregation pipeline access, and no data migrations. PN has an opportunity to offer a genuinely Mongo-native experience.

## What makes MongoDB different

MongoDB's data model is fundamentally different from SQL in ways that stress every layer of the PN stack:

**Embedded documents replace joins.** The idiomatic MongoDB pattern is to store related data inside the parent document — a User contains an Address, a Post contains its Comments. There's no SQL equivalent. This blurs the line between "relation" and "field" in PN's contract model, and changes how the ORM loads and mutates related data. See [mongodb-primitives-reference.md](mongodb-primitives-reference.md) and [mongo-idioms.md](mongo-idioms.md).

**No schema enforcement by default.** MongoDB doesn't enforce types at the storage level. A field declared as `number` in the contract might contain a string in the database. This means PN's contract guarantees are aspirational, not structurally enforced — the runtime must decide what to do when reality doesn't match the contract.

**Update operators replace `SET`.** SQL mutations are "set column = value." MongoDB mutations use operators (`$set`, `$inc`, `$push`, `$pull`) that express field-level patches. The ORM's mutation surface needs to accommodate both the shared pattern (plain data updates) and Mongo-native operations (atomic increments, array mutations).

**Queries are structured data, not strings.** SQL queries are compiled to text strings. MongoDB queries are already JSON-like objects — there's no serialization step. This means the execution plan, the plugin interface, and the driver interface all need different shapes for Mongo than for SQL.

**No referential integrity.** MongoDB has no foreign keys, no cascading deletes, no database-level guarantees about references. If PN enforces referential integrity for Mongo users, it does so entirely in application code — with real performance and atomicity implications.

## What we're building

PN offers MongoDB users three things they can't get elsewhere:

1. **A contract as the source of truth.** Describe your domain once — models, fields, types, relations, and the explicit choice of embed vs. reference. Everything downstream (types, queries, validation) derives from this contract. See [user-promise.md](user-promise.md).

2. **Type-safe, Mongo-native queries.** Operations checked against the contract at compile time. Filter on embedded fields with dot notation. Use `$inc` and `$push` through the ORM. Get the same `findMany`/`create`/`update`/`where` patterns as SQL-PN, with Mongo-specific extensions where the semantics differ.

3. **Guardrails MongoDB doesn't provide.** Configurable referential integrity (cascade, restrict, setNull). Schema validation on writes and configurable validation on reads. Runtime plugins for budgets, linting, and telemetry.

See [example-schemas.md](example-schemas.md) for three concrete MongoDB schemas with speculative PSL and query patterns.

## What we know so far

Several key architectural questions have been answered through analysis of the existing codebase:

**Mongo is its own family, not a target under "document."** The SQL family abstraction works because SQL databases share a common query language. There is no equivalent shared interface for document databases — MongoDB and Firestore have different query languages, different data organization models, and different capabilities. A "document family" would contain very little that isn't trivially generic or actually MongoDB-specific. The contract hierarchy is `ContractBase` → `SqlContract` / `MongoContract`, with each family owning its own targets.

**The execution pipeline doesn't generalize across families.** Analysis of the existing SQL plugins ([budgets](../../../packages/2-sql/5-runtime/src/plugins/budgets.ts), [lints](../../../packages/2-sql/5-runtime/src/plugins/lints.ts)) shows they directly inspect SQL-specific fields — `plan.sql`, `plan.ast`, SQL AST node types. Any generalization of `ExecutionPlan` either forces every plugin to branch on family, strips the plan to useless metadata, or adds complexity without enabling reuse. Each family gets its own plan type (`MongoQueryPlan`), plugin interface (`MongoPlugin`), and runtime (`MongoRuntimeCore`). What IS shared is the plugin lifecycle pattern (`beforeExecute → onRow → afterExecute`) and the metadata (`PlanMeta`). See [execution-architecture.md](execution-architecture.md).

**Streaming subscriptions are a separate operation type.** Both Mongo (change streams) and SQL (logical replication) have real-time streaming models, but they have fundamentally different lifecycles from request-response queries. Subscriptions don't complete — they run until closed. The shared component is the lifecycle pattern, not the query payload. The PoC doesn't implement subscriptions but must not prevent them.

## What we don't know yet

The open design questions are tracked in [design-questions.md](design-questions.md). The most consequential ones:

**How do embedded documents appear in the contract?** This is the foundational question — the answer ripples through every layer. Options: relations with a storage strategy (keeps the domain model clean but blurs query semantics), nested field types (simpler but loses queryability), or a distinct concept (most flexible but adds a new abstraction). See [design question #1](design-questions.md#1-embedded-documents-relation-field-or-distinct-concept).

**What belongs in `ContractBase`?** Today, `ContractBase` doesn't include models or relations — `SqlContract` adds them. If `MongoContract` adds its own incompatible version, consumer libraries can't be family-agnostic. Getting this boundary right is what makes or breaks cross-family reuse. See [design question #10](design-questions.md#10-shared-contract-surface-what-goes-in-contractbase).

**How does the contract represent polymorphism?** Discriminated unions (a `tasks` collection containing Bug, Feature, and Chore documents distinguished by a `type` field) are common in MongoDB and also needed for SQL single-table inheritance. This is a cross-family concern that must be validated in April. See [design question #6](design-questions.md#6-polymorphism-and-discriminated-unions-validate-in-april).

**How does the ORM mutation surface accommodate Mongo's update operators?** `$inc`, `$push`, `$pull` have no SQL equivalent. The shared ORM `update()` can handle plain data (compiled to `$set`), but atomic operators need either family-specific extensions to the shared interface or separate methods. See [design question #4](design-questions.md#4-update-operators-shared-orm-surface-vs-mongo-native-operations).

**How does `include` work for referenced relations?** SQL uses joins. Mongo uses application-level stitching or `$lookup` in an aggregation pipeline. Embedded relations don't need loading at all — they're always present. See [design question #7](design-questions.md#7-relation-loading-application-level-joining-vs-lookup).

Additional open questions cover [referential integrity enforcement](design-questions.md#2-referential-integrity-enforcement), [read-time schema validation](design-questions.md#5-schema-validation-and-read-time-guarantees), and [aggregation pipeline scope](design-questions.md#8-aggregation-pipeline-dsl-scope-and-timing). Deferred questions (not PoC scope) include [introspection](design-questions.md#11-introspection-generating-a-contract-from-an-existing-database), [extension packs](design-questions.md#12-mongodb-specific-extension-packs), [field-level encryption](design-questions.md#13-client-side-field-level-encryption-csfle-and-queryable-encryption), and [schema evolution via data invariants](design-questions.md#14-schema-evolution-as-data-migration-cross-workstream).

## How we're finding answers

**Consumption-first.** Start from importing and querying a contract, not from authoring or emission. The contract shape is driven by what the query client needs, because querying is the primary user interaction. Authoring and emission are machines that produce artifacts — build them once you know the target shape.

**Spike then extract.** Build a `mongo-orm-client` package completely independent of `sql-orm-client` — no shared base class, no imports from the SQL ORM, no predicted abstractions. After both implementations work, compare them and extract the shared interface. The abstraction is discovered from two concrete implementations, not predicted from one.

**Vertical slice, then broaden.** The first phase hand-crafts a contract, writes the ORM client code, and wires it to a real MongoDB instance. Follow-on phases broaden the query surface, test embedded document operations, test referenced relation loading, validate cross-family reuse, and spike polymorphism.

The full step-by-step plan, including architectural risks mapped to design questions, is in [mongo-poc-plan.md](mongo-poc-plan.md).

### Scope and status

This work stream is [workstream 4](../april-milestone.md#4-mongodb-poc--validate-the-second-database-family) of the [April milestone](../april-milestone.md). The PoC plan currently covers the first phase (consumption-first vertical slice). The following are in-scope for April but not yet planned in detail — they will be added as project specs when the first phase answers the foundational questions:

- **Emitter pipeline generalization** — the authoring surfaces and emission process are coupled to SQL; this must be proven for Mongo before end of April
- **Shared ORM interface extraction** — extracted after both ORM clients work independently
- **Cross-family consumer validation** — a consumer library working against both SQL and Mongo contracts without family-specific code

## Testing strategy

The PoC requires integration tests against a real MongoDB instance.

- **Provisioning**: Docker Compose with a single-node replica set (replica set required for change streams and transactions). Testcontainers is an alternative if the repo already uses it.
- **Type-level tests**: Contract design and ORM client API are validated with type-level tests — TypeScript files that must typecheck against the hand-crafted contract types. No running database needed.
- **Integration tests**: Query execution requires a running MongoDB instance. Tests use the real `mongodb` Node.js driver under the adapter.
- **Conventions**: Follow the repo's existing patterns — vitest, `pnpm test`, package-local test config. See the [Testing Guide](../../Testing%20Guide.md).

## Package layout

New packages live under a `mongo` domain, parallel to `packages/2-sql/`:

```
packages/3-mongo/
  1-core/          -- MongoContract types, MongoQueryPlan, MongoPlanMeta
  4-lanes/         -- mongo-orm-client (independent of sql-orm-client)
  5-runtime/       -- MongoRuntimeCore, MongoPlugin interface
  6-adapters/      -- MongoDriver (wraps the mongodb Node.js driver)
```

Layer numbering follows the existing Domain -> Layer -> Plane structure. The existing `document` family stub package will be replaced. Package boundaries are enforced by `pnpm lint:deps`.

## Further reading

**Analysis docs** — design decisions and rationale:
- [user-promise.md](user-promise.md) — the full value proposition for Mongo users
- [execution-architecture.md](execution-architecture.md) — why the execution pipeline is family-specific and what's shared
- [design-questions.md](design-questions.md) — all 14 open architectural questions with full analysis

**Reference material** — context, read as needed:
- [mongodb-primitives-reference.md](mongodb-primitives-reference.md) — MongoDB's data model, type system, query language, and transactions
- [mongo-idioms.md](mongo-idioms.md) — patterns experienced MongoDB developers use and expect
- [example-schemas.md](example-schemas.md) — three concrete schemas with speculative PSL and query patterns
- [references/](references/) — external documents from the MongoDB engineering team

**Plan** — sequencing and risks:
- [mongo-poc-plan.md](mongo-poc-plan.md) — PoC steps, follow-on steps, and architectural risks

## Maintaining these docs

This README is the source of truth for "what do we know and what don't we know." Keep it current as the work stream progresses.

- **Design question resolved**: Update the narrative in "What we know so far" (or remove from "What we don't know yet"), update the full analysis in [design-questions.md](design-questions.md) with the resolution and rationale, and link any new analysis document (as was done for [execution-architecture.md](execution-architecture.md) when question #3 was resolved).
- **Design question added**: Add to [design-questions.md](design-questions.md) first, then mention in "What we don't know yet" if it's consequential.
- **Plan scope changes**: Update [mongo-poc-plan.md](mongo-poc-plan.md) and the "Scope and status" section above to match.
- **Implementation begins**: Create a Drive project spec under `projects/`. These research docs are the design reference, not task trackers.
- **Reference material** (`mongodb-primitives-reference.md`, `mongo-idioms.md`, `example-schemas.md`) is stable context and rarely needs updates.
