# Project Brief: Extending the IR with Models and Storage Mappings

## Intent

The goal of this project is to extend the existing **Relational Intermediate Representation (IR)** so that it captures not only the physical database structures (tables, columns, constraints) but also the **logical data models** defined in PSL (Prisma Schema Language) and their mappings to underlying storage mechanisms.

This enhancement bridges the conceptual gap between the **user’s schema definitions** (models, fields, relations) and the **generated IR**, making the IR more expressive, reflective of PSL semantics, and future-proof for supporting multiple storage targets (e.g., SQL and Mongo).

The result should enable:
- **Bidirectional introspection** between models and tables
- **Deterministic code generation** for both relational and non-relational stores
- **Agent accessibility** — models are now explicit, machine-readable entities in the IR
- **Future multi-store unification** — a consistent way to describe mappings regardless of backend

---

## Overview

Currently, the IR captures **only physical relational entities** (tables, columns, indexes, constraints) and lacks awareness of:
- Model-level abstractions from PSL (`model User { ... }`)
- Field-level mappings between model fields and table columns
- Non-table-backed constructs (views, composites, Mongo collections)
- Derived mappings (e.g., field → computed column or virtual field)

This makes it difficult to:
- Reconstruct high-level schema intent from the IR
- Unify relational and document backends under a shared contract model
- Support future tools (e.g. introspection, migrations, documentation generators) that need to understand how a model maps to underlying data

This project introduces a **Model layer** above the table abstraction — an explicit representation of PSL models and their storage mappings.

---

## Context

### Current State
- The IR (`ContractSchema`) defines `tables` and related entities.
- It is strictly relational and Postgres-specific.
- The generated `contract.json` is optimized for runtime query building and validation, not for reconstructing or reasoning about model-level semantics.
- Tools that need PSL-level information (like migration planners or schema explorers) must reparse PSL directly.

### Target State
- Models are explicitly represented in the IR.
- Each model specifies how it maps to storage (e.g., a SQL table, a Mongo collection).
- Each model’s fields define how they map to physical storage columns or embedded paths.
- The contract remains deterministic and verifiable, with a stable hash.
- This representation supports both current (Postgres) and future (Mongo, PlanetScale, etc.) backends.

---

## Implementation Plan

### Phase 1 — Add Model Definitions to the IR

Introduce a new `ModelSchema` type:

```ts
export const ModelSchema = z.object({
  name: z.string(),
  storage: z.object({
    kind: z.enum(['table', 'view', 'collection']),
    target: z.string(), // e.g., table name or collection name
  }),
  fields: z.record(
    z.string(),
    z.object({
      type: z.string(),
      isList: z.boolean().optional(),
      isOptional: z.boolean().optional(),
      mappedTo: z.string().optional(), // column or nested path
      relation: z
        .object({
          kind: z.enum(['1:N', 'N:1', 'M:N']),
          target: z.string(),
          foreignKey: z.string().optional(),
        })
        .optional(),
    })
  ),
  meta: z.object({
    source: z.string().optional(),
    comments: z.string().optional(),
  }).optional(),
});

## Design decisions

1) Model-to-storage mapping strategy

Choose: (a) Add a models field directly to the ContractSchema alongside tables.

Why
	•	Keeps tables as the physical source of truth for the runtime, planner, and SQL lowerers you already have.
	•	Adds a logical layer (models) that points to storage targets (e.g., table names) without disrupting existing consumers.
	•	Avoids a breaking change now; gives us room to iterate on model semantics (relations, computed fields) independently.

Implementation note: models[modelName].storage = { kind: 'table', target: '<tableName>' }.

⸻

2) Field mapping granularity

Choose: (a) Map each model field to exactly one column/path (MVP).
Roadmap: (b) computed/derived; (c) virtual.

Why
	•	MVP stays simple and deterministic: 1 PSL field ⇄ 1 column. Easy to validate against tables.
	•	Unblocks immediate uses (type emission, agent readability, doc tooling).
	•	We can add computed/virtual fields later without reworking the core.

Validation: every models[X].fields[f].mappedTo must exist in tables[target].columns.

⸻

3) Relation representation

Choose: (c) Store relations in tables only; infer model-level relations from FKs.

Why
	•	Avoids dual sources of truth and drift (no duplicated relation data).
	•	You already have FK-driven relation graphs; keep FKs authoritative and derive model relations during emit (or expose a derived view in the contract output if needed).
	•	Keeps planners and runners anchored to physical constraints while still giving agents/humans a model-centric view.

If we want a model-level relations view for agents, mark it as derived in the contract (clearly not authoritative).

⸻

4) Backwards compatibility

Choose: (a) Additive change. Existing contract.json without models continues to work.

Why
	•	Minimizes disruption; all current code paths using tables remain valid.
	•	New features (model-aware tools, docs, agents) can feature-detect the models key.
	•	Lets teams adopt the model layer incrementally.

⸻

Summary
	•	Add models next to tables; don’t replace tables.
	•	Start with 1:1 field→column mapping; defer computed/virtual fields.
	•	Keep FKs authoritative in tables; derive model relations from them.
	•	Make it additive so current contracts keep working.

This gives us a clean, low-risk step that unlocks model-aware tooling and agent workflows now, while preserving a single physical source of truth for planning and execution.
