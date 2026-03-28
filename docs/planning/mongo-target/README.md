# MongoDB Work Stream

Validate that the Prisma Next architecture can accommodate a second database family. This is [workstream 4](../april-milestone.md#4-mongodb-poc--validate-the-second-database-family) of the April milestone.

## April milestone reconciliation

The milestone stop condition requires:

> A consumer library works against both a SQL and a document contract without family-specific code, backed by a real vertical slice (not just types) where the document contract was authored, emitted, and queried through the runtime and ORM. Both ORM clients satisfy a shared interface.

The [PoC plan](mongo-poc-plan.md) currently covers the first phase: hand-crafted contract, ORM client, and query execution against a real MongoDB instance. This validates the foundational questions (contract shape, execution pipeline, ORM surface) using a consumption-first approach.

The plan is incomplete. The following are in-scope for April but not yet planned in detail:

- **Emitter pipeline generalization** — the authoring surfaces and emission process are coupled to SQL today; this must be proven for Mongo before end of April
- **Shared ORM interface extraction** — the PoC builds `mongo-orm-client` independently of `sql-orm-client`; the shared interface is extracted after both work
- **Cross-family consumer validation** — a consumer library working against both SQL and Mongo contracts without family-specific code

These will be added as project specs when the consumption-first phase answers the foundational design questions.

## User promise

PN offers MongoDB users three things they can't get elsewhere: (1) a single contract that serves as the source of truth for their domain model, separating what data means from how it's stored; (2) a type-safe query surface where operations are checked against the contract at compile time, with Mongo-native extensions like `$inc` and `$push`; (3) configurable guardrails — referential integrity, schema validation, and runtime plugins — that MongoDB doesn't provide natively.

See [user-promise.md](user-promise.md) for the full articulation.

## Open questions

These are the design questions the PoC must answer or has already resolved. They are the organizing spine of this work stream. See [design-questions.md](design-questions.md) for the full analysis of each.

### Contract shape

| # | Question | Status |
|---|---|---|
| [1](design-questions.md#1-embedded-documents-relation-field-or-distinct-concept) | How do embedded documents appear in the contract? (relation, field, or distinct concept) | **open** |
| [10](design-questions.md#10-shared-contract-surface-what-goes-in-contractbase) | What belongs in `ContractBase` vs. family-specific extensions? | **open** |
| [6](design-questions.md#6-polymorphism-and-discriminated-unions-validate-in-april) | How does the contract represent discriminated unions / model inheritance? (cross-family) | **open** — April must-prove |

### Execution pipeline

| # | Question | Status |
|---|---|---|
| [3](design-questions.md#3-execution-plan-generalization) | Can `ExecutionPlan` generalize across families? | **resolved** — each family gets its own plan type, plugin interface, and runtime. See [execution-architecture.md](execution-architecture.md) |
| [9](design-questions.md#9-change-streams-and-the-runtimes-execution-model) | Does the runtime accommodate unbounded streaming subscriptions? | **analysis complete, deferred** — subscriptions are a separate operation type with their own lifecycle. See [execution-architecture.md](execution-architecture.md) |

### ORM surface

| # | Question | Status |
|---|---|---|
| [4](design-questions.md#4-update-operators-shared-orm-surface-vs-mongo-native-operations) | How does the ORM mutation surface accommodate Mongo's update operators? | **open** |
| [7](design-questions.md#7-relation-loading-application-level-joining-vs-lookup) | Application-level joining vs. `$lookup` for relation loading? | **open** |
| [8](design-questions.md#8-aggregation-pipeline-dsl-scope-and-timing) | What scope for aggregation pipeline support in the PoC vs. later? | **open** |

### Data integrity

| # | Question | Status |
|---|---|---|
| [2](design-questions.md#2-referential-integrity-enforcement) | What level of referential integrity does PN enforce for Mongo? | **open** |
| [5](design-questions.md#5-schema-validation-and-read-time-guarantees) | What does PN guarantee about data returned from reads? | **open** |

### Deferred

| # | Question | Status |
|---|---|---|
| [11](design-questions.md#11-introspection-generating-a-contract-from-an-existing-database) | Introspection from an existing MongoDB database | deferred (table-stakes for adoption, not PoC) |
| [12](design-questions.md#12-mongodb-specific-extension-packs) | Extension packs for Vector Search, Atlas Search, geospatial | deferred |
| [13](design-questions.md#13-client-side-field-level-encryption-csfle-and-queryable-encryption) | Client-side field-level encryption | deferred |
| [14](design-questions.md#14-schema-evolution-as-data-migration-cross-workstream) | Schema evolution via data invariants (cross-workstream with migrations) | deferred |

## Approach

**Consumption-first**: Start from importing and querying a contract, not authoring/emission. The contract shape is driven by what the query client needs.

**Mongo is its own family**: `familyId: 'mongo'`, not `familyId: 'document'`. There is no shared query interface across document databases the way SQL unifies relational databases.

**Spike then extract**: Build `mongo-orm-client` independently of `sql-orm-client`. Extract the shared interface after both implementations exist, not before.

See [mongo-poc-plan.md](mongo-poc-plan.md) for the concrete steps and architectural risks.

## Testing strategy

The PoC requires integration tests against a real MongoDB instance.

- **Provisioning**: Docker Compose with a single-node replica set (replica set required for change streams and transactions). Testcontainers is an alternative if the repo already uses it.
- **Type-level tests**: Steps 1–2 (contract design, ORM client API) are validated with type-level tests — TypeScript files that must typecheck against the hand-crafted contract types. No running database needed.
- **Integration tests**: Step 3 onward (query execution) requires a running MongoDB instance. Tests use the real `mongodb` Node.js driver under the adapter.
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

## Reading guide

**Analysis docs** — read these for design decisions and rationale:
- [user-promise.md](user-promise.md) — what we're building and why a Mongo user would choose PN
- [execution-architecture.md](execution-architecture.md) — why the execution pipeline is family-specific and what's shared
- [design-questions.md](design-questions.md) — the full tracker of open architectural questions

**Reference material** — read as needed for context:
- [mongodb-primitives-reference.md](mongodb-primitives-reference.md) — MongoDB's data model, type system, query language, and transactions
- [mongo-idioms.md](mongo-idioms.md) — patterns experienced MongoDB developers use and expect
- [example-schemas.md](example-schemas.md) — three concrete schemas with speculative PSL and query patterns
- [references/](references/) — external documents from the MongoDB engineering team

**Plan** — read for sequencing:
- [mongo-poc-plan.md](mongo-poc-plan.md) — PoC steps, follow-on steps, and architectural risks
