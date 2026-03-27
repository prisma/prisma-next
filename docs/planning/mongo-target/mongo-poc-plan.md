# MongoDB / Document Family PoC — Plan

## Goal

Scaffold a representative MongoDB target that validates the architecture can accommodate a non-SQL database family. The primary deliverable is confidence in the **cross-family extension surface** — specifically, that consumer libraries can target both SQL and document families through shared interfaces for models, fields, and relations.

This is a prerequisite for the April "ready for external contributions" milestone. Without it, we risk stabilizing SQL-specific interfaces that break when the document family ships, or an extension ecosystem fragmented by database family.

## What's in scope

- A real `DocumentContract` populated from a schema
- Document family hook, target descriptor, adapter, and driver (at least stubbed)
- Document execution context
- At least one consumer library that works against both SQL and document contracts
- Enough to hand off to the MongoDB team to extend

## What's out of scope (for the PoC)

- Production-quality MongoDB driver
- Full query DSL / aggregation pipeline builder
- Migrations / schema diffing for document databases
- PSL authoring for document schemas (TypeScript authoring is sufficient)
- Comprehensive codec coverage
- Performance, connection pooling, production error handling

---

## Major pieces

### 1. Models and relations as the shared contract surface

Models and relations are application domain concerns — they describe the shape of the user's data and how entities relate to each other. The persistence mechanism (SQL tables vs. document collections) is family-specific; the domain model is not.

Today, `ContractBase` (in `packages/1-framework/1-core/shared/contract/src/types.ts`) does **not** include `models` or `relations` — these are added by `SqlContract`. `DocumentContract` also omits them. This means there is currently no shared type that both SQL and document contracts extend which includes the schema graph.

**This is the most important architectural question for the PoC**: models and relations need to be promoted to the shared contract surface so that consumer libraries (validators, GraphQL, visualization, etc.) can accept any contract and traverse its domain model without knowing the target family.

Key decisions:
- What is the shared model/relation type? Can we reuse the existing `ModelDefinition` / `ModelField` / `RelationDefinition` types, or do they need to evolve?
- How do models map to storage in each family? SQL has `mappings` (model → table, field → column). Document needs an equivalent (model → collection, field → document path).
- Are embedded documents modeled as relations, as nested fields, or as something else?
- How do family-specific storage details (SQL columns, document fields) relate to the shared model fields?

### 2. Contract & schema

What does a real MongoDB `DocumentContract` look like when populated?

The existing `DocumentStorage` type defines collections with fields and indexes:
```typescript
interface DocumentStorage {
  readonly document: {
    readonly collections: Record<string, DocCollection>;
  };
}

interface DocCollection {
  readonly name: string;
  readonly id?: { readonly strategy: 'auto' | 'client' | 'uuid' | 'objectId' };
  readonly fields: Record<string, FieldType>;
  readonly indexes?: ReadonlyArray<DocIndex>;
  readonly readOnly?: boolean;
}
```

Key decisions:
- How do MongoDB-specific features map? Embedded documents, arrays of subdocuments, ObjectId, MongoDB-specific index types (text, geospatial, TTL).
- What capabilities does MongoDB advertise? What capability flags affect consumer library behavior?
- Does `DocumentContract` need `mappings` (model name → collection name, field name → document path), mirroring SQL's `modelToTable` / `fieldToColumn`?

### 3. Authoring

How does the user define a document schema? For the PoC, TypeScript authoring is sufficient — no PSL support needed.

Key decisions:
- What does the TypeScript authoring API look like for document contracts? Similar to SQL's `defineContract` / column helpers, but with document-specific primitives (embedded documents, arrays, ObjectId).
- Can we reuse any of the existing authoring infrastructure (contract-ts)?

### 4. Emitter / contract.d.ts

The emitter needs a document family hook implementing `TargetFamilyHook`:
- `validateTypes` — validate type IDs against extension packs
- `validateStructure` — validate document-specific contract structure
- `generateContractTypes` — produce `contract.d.ts` for document contracts

Key decisions:
- What do the emitted types look like for a document contract? Model types, embedded document types, array types.
- How do codec types work for document databases? MongoDB has its own type system (BSON).

### 5. Runtime / execution context

A document execution context — the equivalent of `ExecutionContext` for the document family.

Today, `ExecutionContext` is SQL-specific (SQL operations, SQL codecs, SQL query plans). The document family needs its own execution context, but ideally there's a shared base that consumer libraries can target.

Key decisions:
- What's shared between SQL and document execution contexts? Contract access, codec registry shape, operation signatures?
- What's the plan shape for document queries? MongoDB uses aggregation pipelines, not SQL strings. The existing `ExecutionPlan` has `sql: string` — this needs to generalize.
- How do consumer libraries accept "any execution context"? A shared interface? A generic? A union?

### 6. Adapter & driver

MongoDB adapter (capability discovery, lowering) and driver (transport — the MongoDB Node.js driver).

The test fixture at `test/integration/test/fixtures/cli/cli-integration-test-app/fixtures/emit-command/prisma-next.config.document-family.ts` already shows the descriptor shape for a document family config.

For the PoC:
- Adapter: stub that advertises basic capabilities, performs minimal lowering
- Driver: thin wrapper around the MongoDB Node.js driver, implementing `execute` and `close`
- Target descriptor: MongoDB target metadata

### 7. ORM client / collections

Does the document family get its own `Collection` variant, or can the existing ORM client work across families?

The ORM client today is SQL-specific — it compiles collection state into `SqlQueryPlan` and uses SQL-specific query planning. For the PoC, we need at least a basic document collection that supports `findMany`, `findFirst`, `create`, and `where`.

Key decisions:
- Can the `Collection` base class abstract over both SQL and document query compilation?
- Or does each family provide its own collection implementation behind a shared interface?
- What ORM operations make sense for both families? (`findMany`, `findFirst`, `create`, `update`, `delete` seem universal)

### 8. Cross-family extension surface (the key deliverable)

This is the reason the PoC is essential. We need to demonstrate:

**A. A consumer library accepting any contract (contract-only level)**

A tool like `contractToJsonSchema(contract)` that traverses models and fields regardless of family. This validates that the shared model/relation surface works.

**B. A consumer library accepting any execution context (runtime level)**

A tool like `createValidators(context)` that derives validators from model metadata regardless of family. This validates that the shared execution context surface works.

**C. Extension target/family declaration**

How does an extension declare what it supports? Options:
- Accepts the shared contract base → works everywhere
- Accepts `SqlContract` → SQL-only
- Accepts `DocumentContract` → document-only
- Accepts a union → explicit multi-family support

**D. Detection and traversal**

How does a consumer library detect what kind of contract it received and traverse family-specific storage when needed? The existing `isDocumentContract()` type guard is a starting point.

---

## Sequencing

Suggested order of implementation:

1. **Promote models/relations to `ContractBase`** — this is the foundation everything else builds on. Ensure `SqlContract` and `DocumentContract` both inherit from a contract base that includes the shared schema graph.

2. **Document contract authoring** — TypeScript API to define a document contract with models, relations, collections, fields, embedded documents.

3. **Document family hook + emitter** — emit `contract.json` and `contract.d.ts` for document contracts.

4. **Document adapter + driver stub** — enough to execute basic queries against a real MongoDB instance.

5. **Document execution context** — shared base with SQL, document-specific extensions.

6. **Document ORM client** — basic `findMany`, `create`, `where` against MongoDB.

7. **Cross-family consumer library example** — at least one consumer library that works with both SQL and document contracts (e.g. contract-to-JSON-Schema, or a trivial validator).

---

## Open questions

- Do we need a shared `ExecutionContext` base type, or do consumer libraries accept a union of family-specific contexts?
- How do embedded documents (a MongoDB-native concept) map to the shared model/relation graph? Are they modeled as relations, nested fields, or a distinct concept?
- Does the ORM client need a family-agnostic `Collection` base, or do families provide separate collection implementations behind a shared interface?
- What's the minimum viable MongoDB driver for the PoC? Can we use the official `mongodb` Node.js driver directly?
- How do we handle the `ExecutionPlan.sql` field? It's a string today — does it become `query: string | Pipeline` or do we split by family?
