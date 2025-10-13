# Project Brief: Prisma Next — Deterministic Migration System

## Overview

This project introduces a deterministic, replayable migration system that extends Prisma Next's contract-first architecture. The goal is to provide a minimal yet robust user experience for managing schema evolution—aligning PSL-defined desired state, database contract state, and migration programs.

The resulting system must:
- Keep PSL as the single source of truth
- Generate deterministic migration programs based on PSL diffs
- Allow portable replay across environments (dev, staging, prod)
- Support squashing history without introducing a separate "baseline" concept

The design uses a single migration package format with meta.json and opset.json, avoiding multiple parallel abstractions or heavy tooling.

---

## Goals

1. **PSL as truth**: The current schema.prisma always defines desired state.
2. **Deterministic ops**: PSL(A) + PSL(B) → reproducible op-set (opset.json).
3. **Replayable**: The same migration package can be applied anywhere.
4. **Environment verification**: DB hash must match meta.from.
5. **Minimal UX**: File-based workflow, no complex CLI arguments.
6. **Extensible**: Future phases can introduce drift detection and re-planning.

---

## Architecture Overview

```
prisma/
  schema.prisma          # Desired PSL state (source of truth)
  contract.json          # Generated IR from PSL (contains contractHash)
  migrate.config.json    # Environment configuration (optional)

migrations/
  2025-10-13T0912_add-user-active/
    meta.json            # metadata (from, to, target, policy, supersedes)
    opset.json           # deterministic schema operations
    notes.md             # optional human context
```

**Database state tracking:**
- A prisma_contract table stores { contract_hash, updated_at }.
- Used for verifying schema version consistency across environments.

---

## Phase 1 — Minimal Foundations

### 1. PSL Hash Integration

- Use existing contractHash in contract.json as DB identity.
- Add prisma_contract table migration to each new DB:

```sql
CREATE TABLE prisma_contract (
  contract_hash text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO prisma_contract (contract_hash) VALUES ('sha256:<hash>');
```

### 2. Migration Package Format

Define the canonical shape of migration folders:

```json
// meta.json
{
  "id": "2025-10-13T0912_add-user-active",
  "target": "postgres",
  "from": { "kind": "contract", "hash": "sha256:<A>" },
  "to":   { "kind": "contract", "hash": "sha256:<B>" },
  "opSetHash": "sha256:<ops>",
  "mode": "strict",
  "supersedes": [],
  "notes": "Add user.active column"
}
```

opset.json includes deterministic DDL operations.

### 3. Deterministic Planner
- **Input**: two contract.json files (A and B)
- **Output**: ordered list of structural ops:
- addTable, dropTable, addColumn, alterColumn, addIndex, etc.
- **Planner ensures**:
- Stable operation ordering
- No dependence on DB runtime
- Same diff → same opset.json hash

### 4. CLI Commands (initial)
- `pn prisma-next psl emit` → writes contract.json
- `pn prisma-next migrate plan` → generates new migration folder with {meta.json, opset.json}
- `pn prisma-next migrate status` → compares DB and contract.json

---

## Phase 2 — Migration Application

### 1. Apply Workflow

Implement migrate apply:
- Reads current DB contract_hash
- Loads next applicable migration (meta.from matches DB)
- Verifies compatibility based on mode (strict or tolerant)
- Lowers opset.json to SQL and executes
- Writes new contract_hash to prisma_contract

### 2. AdminConnection

Introduce AdminConnection class:
- Enforces elevated privileges (DDL-safe)
- Runs all operations in a transaction
- Provides execDDL() and recordContract() helpers

### 3. Verification Modes
- **Strict**: DB.contractHash === meta.from.hash → run
- **Tolerant**: skip already-satisfied ops (safe for staging/dev)
- Fail gracefully with descriptive message otherwise

---

## Phase 3 — Migration Composition and Squashing

### 1. Composition

Implement deterministic composition:
- Merge multiple opset.json into one (opset.compose([ops1, ops2]))
- Result is stable and hashable

### 2. Squashing

`pn prisma-next migrate squash --range <from>..<to>`:
- Generates a single migration package from composed ops
- Example:

```json
{
  "id": "2025-11-01T1000_squash-A-to-Z",
  "from": { "kind": "contract", "hash": "sha256:<A>" },
  "to":   { "kind": "contract", "hash": "sha256:<Z>" },
  "opSetHash": "sha256:<ops>",
  "supersedes": ["2025-10-10T...", "2025-10-20T..."]
}
```

- Superseded migrations can be archived.

---

## Phase 4 — Convenience Tools and Drift Handling

### 1. Auto-Detection
- `migrate status` compares:
- contract.json.contractHash
- DB's prisma_contract.contract_hash
- Latest migration meta.to.hash

### 2. Drift Detection
- Optional: query live DB schema → compute hash → compare to expected from
- Offer --replan flag to reconcile automatically (later phase)

### 3. Config

Add migrate.config.json to handle environments and policies:

```json
{
  "defaultEnv": "development",
  "envs": {
    "development": { "urlFrom": ".env", "urlKey": "DATABASE_URL" },
    "production":  { "urlFrom": ".env.production", "urlKey": "DATABASE_URL" }
  },
  "applyDefaultPolicy": "strict"
}
```

---

## Phase 5 — Developer Experience Enhancements

### 1. Preview Commands
- `pn prisma-next migrate diff` → show summary of schema changes
- `pn prisma-next migrate preview` → print SQL of planned ops
- `pn prisma-next migrate explain` → verbose debugging info

### 2. Human Artifacts
- notes.md auto-populated with human-readable summary
- Optional plan.sql for manual review

---

## Implementation Milestones

| Phase | Deliverable | Focus |
|-------|-------------|-------|
| 1 | Contract hash table, migration folder structure | Minimal file UX |
| 2 | Planner, CLI commands emit, plan, apply | Core workflow |
| 3 | Migration composition and squash | History management |
| 4 | Drift detection & config | Reliability |
| 5 | Preview tools & docs | Developer experience |

---

## Success Criteria
- Deterministic PSL(A)→PSL(B) → identical opset.json across machines.
- Replayable migrations applied consistently across environments.
- `migrate status` clearly reports out-of-sync contracts.
- Squash produces portable single-package installers.
- No separate baseline concept required — only unified migration folders.

---

## Summary

This project extends Prisma Next's contract-first design into a verifiable, replayable, and portable migration system. It's file-first, deterministic, and agent-accessible—bridging declarative schema definitions with executable migration logic, while remaining minimal and intuitive for developers.
