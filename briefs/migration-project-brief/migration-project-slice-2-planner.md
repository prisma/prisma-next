# Migration Project Slice 2: Planner

Here's a tight, prototype-sized plan for the Planner slice without hints. It focuses on a safe, deterministic subset that's easy to ship and prove end-to-end.

---

## Planner (MVP) — Project Plan (no hints)

### Purpose

Given two contracts (A = current DB contract; B = desired contract from PSL/IR), produce a deterministic, idempotent op-set (opset.json) that moves A → B.
Scope is intentionally small and safe: only additive and clearly safe changes.

---

## Out-of-scope (for this MVP)
- Renames (tables, columns, indexes, FKs)
- Drops of any kind
- Type changes
- Tightening nullability (nullable → NOT NULL) unless trivially safe (see below)
- Complex default rewrites
- FK ON UPDATE/DELETE behavior changes
- Any heuristic inference or "guessing" (no hints)

This keeps the planner pure and deterministic with low complexity while still useful for many real changes.

---

## Supported changes (MVP)
1. **Add table** (with columns, PK, uniques, indexes, FKs)
2. **Add column** (nullable or NOT NULL only if the column has a default in B)
3. **Add unique** (table, columns…)
4. **Add index** (btree default)
5. **Add foreign key** (requires referenced table+cols exist; ensures equality index on referencing cols if missing)

That's it. If B requires anything else, the planner fails with an actionable message (e.g., "rename not supported in MVP").

---

## Determinism rules
- **Inputs**: contractA, contractB, rulesVersion.
- **Planner emits** ops in a canonical order and serializes with sorted keys.
- **opSetHash** = sha256(canonical(opset.json) + rulesVersion).
- **No DB reads**, no environment-dependent behavior.

---

## Operation vocabulary (same shape runner already expects)

```typescript
type ColumnType = 'int4'|'int8'|'text'|'varchar'|'bool'|'timestamptz'|'timestamp'|'float8'|'float4'|'uuid'|'json'|'jsonb';

type ColumnSpec = {
  type: ColumnType;
  nullable: boolean;
  default?: { kind: 'autoincrement'|'now'|'literal'; value?: string };
};

type Op =
  | { kind:'addTable'; table:string; columns:Record<string,ColumnSpec>; primaryKey?: string[] }
  | { kind:'addColumn'; table:string; column:string; spec:ColumnSpec }
  | { kind:'addUnique'; table:string; columns:string[]; name?:string }
  | { kind:'addIndex'; table:string; columns:string[]; name?:string; method?:'btree' }
  | { kind:'addForeignKey'; table:string; columns:string[]; ref:{ table:string; columns:string[] }; name?:string; onDelete?:'noAction'|'restrict'|'cascade'|'setNull'|'setDefault'; onUpdate?: same };
```

---

## Canonical operation ordering
1. **Tables**: addTable (lexicographic by table)
2. **Per table** (lexicographic by table, then op kind):
   - addColumn (by column)
   - addUnique (by columns joined with ,)
   - addIndex (same key order)
   - addForeignKey (by referenced table, then columns)

This ensures a stable opset.json across runs/machines.

---

## Algorithm (MVP)

Let A = contractA.tables, B = contractB.tables.

### 1) Add table detection

For each table t in B not in A:
- Emit addTable with:
  - all columns (from B)
  - primaryKey if present
- Defer uniques, indexes, FKs to later steps (on same run).

### 2) Add column detection

For each table t present in both A and B:
- For each column c in B[t] not in A[t]:
- If B[t].columns[c].nullable === false and no default → fail with message:
  "Cannot add NOT NULL column without default in MVP. Make it nullable or add a default."
- Else emit addColumn.

### 3) Add unique detection
- For each unique in B[t] that doesn't exist in A[t] (same table, same column set order-insensitive), emit addUnique.
- Name generation: deterministically derive if B doesn't specify (e.g., t_cols_key).

### 4) Add index detection
- For each index in B[t] missing in A[t] (by column set + method), emit addIndex.
- Default method: 'btree' if unspecified in B.
- Deterministic name if unspecified (e.g., t_cols_idx).

### 5) Add foreign key detection
- For each FK in B[t] missing in A[t], emit addForeignKey.
- Ensure referencing columns have an equality index:
  - If missing, first emit addIndex on referencing cols (btree).
- Validate referenced table/columns exist in B (and either in A or added by this plan).

### 6) Canonicalize + hash
- Sort ops by the ordering rules.
- Serialize canonical JSON (sorted keys everywhere).
- Compute opSetHash.

### 7) Produce artifacts
- opset.json
- meta.json with:

```json
{
  "target": "postgres",
  "from": { "kind": "contract", "hash": "sha256:<A>" },
  "to":   { "kind": "contract", "hash": "sha256:<B>" },
  "opSetHash": "sha256:<ops>",
  "mode": "strict"
}
```

- diff.json (machine summary) & diff.md (human summary)

---

## Failure messages (actionable)
- **Rename detected**:
  "Table 'users' removed and 'people' added. Renames are not supported in MVP. Use add/drop or wait for the hints release."
- **Drop detected**:
  "Column 'people.legacy_id' present in A but absent in B. Drops are not supported in MVP."
- **Type change detected**:
  "Column 'orders.total' changed type. Type changes are not supported in MVP."
- **NOT NULL without default**:
  "Column 'people.active' added as NOT NULL without default. Make it nullable or add a default."

---

## Interfaces

```typescript
// Input IR contracts (already validated elsewhere)
export type Contract = {
  target: 'postgres';
  contractHash: `sha256:${string}`;
  tables: Record<string, {
    columns: Record<string, ColumnSpec>;
    primaryKey?: string[];
    uniques?: Array<{ columns: string[]; name?: string }>;
    indexes?: Array<{ columns: string[]; name?: string; method?: 'btree' }>;
    foreignKeys?: Array<{
      columns: string[];
      references: { table: string; columns: string[] };
      name?: string;
      onDelete?: 'noAction'|'restrict'|'cascade'|'setNull'|'setDefault';
      onUpdate?: 'noAction'|'restrict'|'cascade'|'setNull'|'setDefault';
    }>;
  }>;
};

export interface PlannerOptions {
  rulesVersion: string;
}

export interface PlanArtifacts {
  opset: { version: 1; operations: Op[] };
  opSetHash: `sha256:${string}`;
  meta: {
    id: string;
    target: 'postgres';
    from: { kind:'contract'; hash: `sha256:${string}` };
    to:   { kind:'contract'; hash: `sha256:${string}` };
    opSetHash: `sha256:${string}`;
    mode: 'strict';
    supersedes: string[];
  };
  diffJson: {
    from: `sha256:${string}`;
    to:   `sha256:${string}`;
    summary: { tablesAdded:number; columnsAdded:number; uniquesAdded:number; indexesAdded:number; fksAdded:number };
    changes: any[]; // simple list for now
  };
  reportMd: string;
}

export function planMigration(
  contractA: Contract | { kind:'empty' }, // empty → treat A.tables = {}
  contractB: Contract,
  opts: PlannerOptions
): PlanArtifacts;
```

---

## Implementation phases

### Phase 1 — Scaffolding & canonicalization
- Contract normalizer (strip non-structural meta; sort keys)
- Op model + canonical serializer + hashing
- Empty→B planning (pure addTable path)
- Golden tests for canonical JSON & hash stability

### Phase 2 — Adds inside existing tables
- Detect addColumn (nullable or NOT NULL with default)
- Detect addUnique, addIndex, addForeignKey (with auto index on referencing cols)
- Deterministic op ordering
- Diff summaries (diff.json, diff.md)
- Tests: per case + combined

### Phase 3 — Fail-fast on unsupported changes
- Detect and fail for renames, drops, type changes, nullability tightening sans default
- Clear error wording with next steps
- Tests for rejection paths

### Phase 4 — Program emission & E2E
- Write {meta.json, opset.json, notes.md} to a new migration folder
- E2E with runner on a temp Postgres: A→B plan → apply → DB contract updated to B
- CLI: migrate plan wiring

---

## Tests (minimal set)
- **addTable**: A={}, B has user → emits addTable (+ uniques/indexes/FKs in follow-up ops), stable snapshot
- **addColumn** (nullable): emits addColumn
- **addColumn** (NOT NULL with default): emits addColumn with spec; OK
- **addColumn** (NOT NULL without default): fails with clear message
- **addUnique / addIndex**: emitted and named deterministically when name absent
- **addForeignKey**: emits FK and supporting index if missing
- **unsupported changes**: each rejection path throws with expected message
- **hash stability**: same inputs → same opSetHash

---

## Example

**A (current)**:

```json
{ "tables": {
  "user": { "columns": { "id":{"type":"int4","nullable":false}, "email":{"type":"text","nullable":false} },
            "primaryKey":["id"] }
}}
```

**B (desired)**:

```json
{ "tables": {
  "user": { "columns": {
              "id":{"type":"int4","nullable":false},
              "email":{"type":"text","nullable":false},
              "active":{"type":"bool","nullable":false,"default":{"kind":"literal","value":"false"}}
           },
           "primaryKey":["id"],
           "uniques":[{"columns":["email"]}] }
}}
```

**Ops (ordered)**:

```json
{
  "version":1,
  "operations":[
    { "kind":"addColumn","table":"user","column":"active","spec":{"type":"bool","nullable":false,"default":{"kind":"literal","value":"false"}} },
    { "kind":"addUnique","table":"user","columns":["email"],"name":"user_email_key" }
  ]
}
```

---

## Why this MVP works
- It's useful today (add tables/columns/uniques/indexes/FKs) and proves the full loop with runner & admin connection.
- It's deterministic and tiny, so you can implement it quickly.
- It sets a clean foundation to add hints later (renames, drops, casts, nullability tightening) without refactoring the core.


---

## Additional design decisions

1) Constraint & index naming

Decision: Match Postgres conventions
	•	PK: {table}_pkey
	•	Unique: {table}_{cols}_key
	•	Foreign key: {table}_{cols}_fkey (cols = referencing columns, in order)
	•	Index: {table}_{cols}_idx

Why this option?
	•	Familiar to most teams and tooling; easy to spot intent at a glance.
	•	Deterministic across machines and planner versions.
	•	Plays nicely with ecosystem defaults (introspection, psql, monitoring).

Policy details:
	•	Lowercase, columns joined by _, stable order.
	•	Enforce the 63-byte identifier cap via a deterministic truncate + short hash suffix to avoid collisions while keeping readability.

⸻

2) FK supporting index

Decision: Emit an index only when needed; ensure coverage before adding the FK.
	•	Check if the referencing columns are already covered by:
	•	a PK/Unique on exactly those columns, or
	•	an existing btree index where those columns are the left-prefix in order.
	•	If not covered, emit an addIndex before the addForeignKey.

Why this option?
	•	Postgres does not auto-create indexes for FKs.
	•	Ensures predictable performance (updates/deletes on parent, lock behavior).
	•	Avoids redundant indexes when a suitable composite/unique already exists.
	•	Keeps the planner deterministic and minimal without guessing “maybe it’s fine.”

⸻

3) Migration ID format

Decision: Timestamp + human slug, e.g. 2025-10-13T0912_add_user_active.
	•	Default: UTC timestamp; slug derived from a short summary.
	•	Allow explicit override (--id) if needed; validate uniqueness.

Why this option?
	•	Sortable, collision-resistant in day-to-day use.
	•	No global counter to coordinate; easy to scan in git and CI logs.
	•	Human-readable without sacrificing determinism.

⸻

4) Planner inputs (no emitting inside planner)

Decision: Planner only accepts pre-emitted IR contracts.
	•	Inputs: contractA (DB’s current contract hash → contract JSON) and contractB (latest emitted contract JSON).
	•	The CLI or build step is responsible for running psl emit before planning.

Why this option?
	•	Keeps the planner pure, testable, and deterministic.
	•	Avoids hidden side effects, version drift, or environment dependencies.
	•	Makes CI flows explicit: “emit → plan → package → apply”.

⸻

5) Determinism & safety (cross-cutting policies)

Canonicalization:
	•	Stable key ordering and canonical op ordering everywhere; opSetHash is reproducible across machines and runs.

Deterministic erroring:
	•	For unsupported changes in the MVP (renames, drops, type changes, NOT NULL without default), fail with clear, actionable messages. No best-effort guessing.

Identifier length:
	•	Always enforce Postgres’s 63-byte cap using a truncate + stable short hash rule for any synthesized name (constraints, indexes). Prevents rare but painful edge cases.

Index method default:
	•	Default to btree for equality/coverage and FK support unless the target contract explicitly requires another method. Keeps behavior predictable.

⸻

6) Out-of-scope for MVP (and why)
	•	Renames, drops, type casts, nullability tightening without default: excluded to keep the planner small, safe, and deterministic. These require explicit intent and will be addressed later (e.g., with PSL hints/pragmas).
	•	Emitter invocation: excluded by design to keep boundaries clean.

⸻

Summary

We’re choosing Postgres-native naming, on-demand FK index synthesis, timestamped migration IDs, and a pure, IR-only planner. These defaults maximize determinism, safety, and familiarity, while keeping the MVP tight and easy to evolve (and leaving clear seams for future features like renames/drops via PSL hints).
