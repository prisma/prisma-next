# Thin Core, Fat Target — Architectural Philosophy

This document explains the **Thin Core, Fat Target** philosophy guiding the Prisma Next architecture. It describes how responsibilities should be distributed between shared core packages and target-specific implementations (like SQL or Mongo), and how this principle keeps the system modular, evolvable, and agent-accessible.

---

## Overview

**Thin Core, Fat Target** means:

> Keep the shared core **minimal, abstract, and durable** — and push as much logic as possible to **target-specific layers**.

The goal is to ensure that the “core” code (shared across all database types) remains stable and easy to reason about, while “target” packages (like `sql`, `mongo`) implement the details that differ between backends.

This separation allows us to:
- Evolve or replace targets independently
- Add new data engines without breaking the rest of the stack
- Maintain clear boundaries between *abstract data modeling* and *storage-specific execution*

---

## Why We Use This Pattern

Traditional ORM architectures tend to centralize all logic in a single, monolithic layer. Over time, this core becomes tightly coupled to the most popular database type (usually SQL). The result: difficult-to-change abstractions, complex branching logic, and code paths that try to emulate one database in the terms of another.

The **Thin Core, Fat Target** model avoids this by reversing the dependency structure:

- The **core** defines shared concepts (e.g., models, fields, relations, contracts)
- Each **target** defines its own mapping, lowering, and execution rules
- The **core never depends on targets**, but targets depend on the core

This way, the “center” of the architecture remains stable, while most of the behavior lives on the “edges,” where variation belongs.

---

## Core Responsibilities

The **core** layer is deliberately narrow. It should define only what is **universally true** across all data engines.

| Concern | Responsibility | Example |
|----------|----------------|----------|
| **Schema abstraction** | Defines models, fields, relations, storage targets | `ModelCore`, `FieldCore`, `RelationCore` |
| **Contract definition** | Canonical, hashable data model | `ContractCore`, `computeContractHash()` |
| **Validation** | Type and structure validation (agnostic to SQL/Mongo) | `validateContract()` |
| **Canonicalization** | Deterministic serialization for hashing and verification | `toCanonicalJSON()` |
| **Builder utilities** | Safe mutation and construction of contracts | `ContractBuilder.addModel()` |
| **Cross-target API** | A minimal, stable interface for all adapters | `toTarget()` / `fromTarget()` |

**The core does *not***:
- Know about SQL types (`int4`, `varchar`, etc.)
- Generate SQL or Mongo queries
- Handle migrations or dialect-specific semantics
- Contain execution logic

---

## Target Responsibilities

A **target** (like SQL or Mongo) is a full implementation of data storage semantics. Each target has its own packages — e.g. `@prisma/sql`, `@prisma/runtime-sql`, `@prisma/migrate-sql`.

| Layer | Responsibilities | Example |
|--------|------------------|----------|
| **Contract adapter** | Translates `contract-core` → `ir-sql` | `contract-sql` |
| **IR schema** | Defines the on-disk serialized structure | `relational-ir` |
| **Query builder** | Constructs and compiles target-specific queries | `sql` |
| **Runtime** | Executes queries, manages connection, applies guardrails | `runtime-sql` |
| **Migration planner** | Computes operations to move from A → B | `migrate-sql` |

Each target:
- Owns its own **type system**
- Defines its own **lowering rules** (from abstract AST → target representation)
- Exposes its own **plugin hooks** and runtime extensions
- Implements its own **migration and verification** logic

Targets are **fat** because they are where the domain-specific complexity lives. The SQL family should know everything about foreign keys, joins, indexes, and DDL — while Mongo should know everything about collections, documents, and projection pipelines.

---

## Example: PSL → Contract → IR

### In the SQL target
1. **PSL Parser (shared)** reads a `schema.psl`
2. **Contract Core (shared)** builds a target-agnostic in-memory model:
   ```ts
   contract.addModel("User", { storage: { kind: "table", target: "user" } });
   ```
3. **SQL Adapter (target)** lowers it into a relational IR:
   ```json
   {
     "tables": {
       "user": {
         "columns": { "id": { "type": "int4" }, "email": { "type": "text" } }
       }
     }
   }
   ```
4. **Planner + Runtime (target)** use this IR to generate SQL migrations or compile queries.

### In the future Mongo target

The same contract might map to:

```json
{
  "collections": {
    "user": {
      "fields": { "_id": "ObjectId", "email": "string" }
    }
  }
}
```

The planner and runtime would then operate with Mongo-specific semantics — but the core contract structure remains the same.

---

## Design Rules

1. **Core is pure and stateless.**
   - No I/O, no database connections.
   - Only defines types, builders, and transformations.
2. **Targets are isolated and responsible for their semantics.**
   - SQL owns DDL, query compilation, and dialect specifics.
   - Mongo owns aggregation, collection ops, and indexing.
3. **Adapters are bridges, not logic containers.**
   - Each adapter's only job is to map between the contract-core and the target's IR.
   - They are replaceable and testable in isolation.
4. **Contracts are deterministic.**
   - Any two identical PSL or TS inputs must produce the same contract hash.
   - All planners, migrations, and runtimes rely on this property.
5. **No cross-target coupling.**
   - No shared "common" abstractions for query compilation.
   - Each target should reimplement what it needs, even if similar to others.
6. **Agent accessibility is first-class.**
   - The contract-core provides a machine-readable graph of models, relations, and fields.
   - Agents can use this graph to plan migrations, suggest queries, or validate drift.

---

## Benefits

| Benefit | Description |
|---------|-------------|
| **Evolvability** | You can add a new backend without refactoring shared code. |
| **Safety** | Each target validates its own invariants without affecting others. |
| **Clarity** | Logical (core) and physical (target) schemas are clearly separated. |
| **Agent Accessibility** | Contracts are human- and machine-readable; no opaque clients. |
| **Incremental adoption** | Teams can upgrade or replace targets independently. |

---

## Anti-Patterns

| Anti-Pattern | Why It's Problematic |
|--------------|----------------------|
| **"Thick core"** | Core starts depending on target-specific logic (e.g. SQL syntax in contract-core). Hard to extend or evolve. |
| **Cross-target coupling** | Adding Mongo breaks SQL tests; target code shouldn't share runtime assumptions. |
| **Universal IR** | Trying to represent SQL and Mongo in one schema leads to lossy abstractions and impossible validation. |
| **Core-level migrations** | Migration planning must live in target space, where DDL/DDL semantics exist. |
| **Bidirectional adapters** | Keep mappings one-directional unless absolutely necessary (contract → IR, not vice versa). |

---

## Summary

**Thin Core, Fat Target** is the guiding principle for the Prisma Next architecture.
- The core is universal, abstract, and minimal.
- Each target (SQL, Mongo, etc.) is self-contained and responsible for implementing its own semantics.
- The boundary between core and target is the data contract, a stable, hashable artifact that defines the schema in a backend-agnostic way.

This separation ensures:
- The core remains stable for years.
- Targets can evolve independently.
- Agents and humans alike can introspect, validate, and reason about the system.

In short: **The core defines what exists. Each target defines how it works.**

