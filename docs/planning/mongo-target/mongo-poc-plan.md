# MongoDB PoC — Plan

## Goal

Validate that the Prisma Next architecture can accommodate a non-SQL database family. The primary deliverable is a working end-to-end path: hand-crafted contract → ORM client → query execution against a real MongoDB instance.

## Approach: consumption-first

Start from the **consumer end** — importing and querying a contract — not the authoring/emission end. The contract shape should be driven by what the query client needs, not by what the authoring layer produces. Authoring and emission are machines that produce artifacts; build them once you know the target shape.

**Deferred to later:**
- PSL authoring for document schemas
- TypeScript authoring API
- Emitter / document family hook
- Production-quality driver, connection pooling, error handling
- Aggregation pipeline DSL
- Migrations / schema diffing

## Steps

### 1. Hand-craft a `contract.json` + `contract.d.ts`

Write the contract artifacts by hand for the [blog platform example schema](example-schemas.md#1-blog-platform). This schema covers the essential patterns: embedded documents (1:1, 1:N), referenced relations, and array fields.

This forces concrete answers to:
- [Design question #1](design-questions.md#1-embedded-documents-relation-field-or-distinct-concept): How do embedded documents appear in the contract?
- [Design question #10](design-questions.md#10-shared-contract-surface-what-goes-in-contractbase): What goes in `ContractBase` vs. family-specific extensions?
- What do document-family mappings look like (model → collection, field → document path)?

**Done when:** a `contract.json` and `contract.d.ts` exist that describe Users, Posts, and Comments with both embedded and referenced relationships.

### 2. Write the ORM client code you wish worked

Write the TypeScript usage code a developer would write to query the blog schema. Import the contract types, call `findMany`, use `where`, `include`, embedded field access, etc.

This is a type-level design exercise: does it typecheck? Does the API feel right? Where do current SQL-oriented assumptions break?

This forces concrete answers to:
- [Design question #4](design-questions.md#4-update-operators-shared-orm-surface-vs-mongo-native-operations): What mutation surface does the ORM expose?
- [Design question #7](design-questions.md#7-relation-loading-application-level-joining-vs-lookup): How does `include` work for embedded vs. referenced?
- Can the `Collection` base class abstract over both families, or does each family provide its own implementation?

**Done when:** a TypeScript file with representative queries typechecks against the hand-crafted contract types, covering `findMany`, `findFirst`, `create`, `update`, `where` with nested/embedded fields, and `include`.

### 3. Make it execute

Wire up the minimum adapter/driver/runtime to actually run the queries from step 2 against a real MongoDB instance.

This forces concrete answers to:
- What does `ExecutionPlan` look like for Mongo? (Today it's `{ sql: string }` — needs to generalize.)
- What's shared between SQL and document execution contexts?
- Is the plugin pipeline actually family-agnostic?
- What codecs are needed for BSON ↔ JS?

**Done when:** the queries from step 2 execute against a local MongoDB and return correct results.

## Reference material

- [Example schemas](example-schemas.md) — concrete MongoDB schemas with speculative PSL and query patterns
- [Design questions](design-questions.md) — open architectural questions this PoC must answer
- [User promise](user-promise.md) — what we're promising Mongo users
- [MongoDB idioms](mongo-idioms.md) — patterns the PoC should accommodate
- [MongoDB primitives reference](mongodb-primitives-reference.md) — data model and query semantics
