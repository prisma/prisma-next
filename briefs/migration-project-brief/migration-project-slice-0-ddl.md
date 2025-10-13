# Migration Project Slice 0: DDL

In this slice we want three small, focused building blocks:
1. an AdminConnection (privileged, single-session, advisory-locked executor)
2. a DDL/Script AST (multi-statement, transaction-aware)
3. a Postgres lowerer (opset → Script AST → SQL rendering rules)

Here's a tight, implementation-ready brief.

---

## 1) AdminConnection (privileged runner)

### Goals
- One physical session (no PgBouncer tx mode).
- Safe defaults (timeouts, search_path, lock timeout).
- Advisory lock wrapper.
- Execute Script AST with tx segmentation.
- Read/write the prisma_contract marker.

### Interface

```typescript
export interface AdminConnection {
  target: 'postgres';
  withAdvisoryLock<T>(key: string, f: () => Promise<T>): Promise<T>;
  executeScript(script: ScriptAST): Promise<{ sql: string; params: unknown[]; sqlHash: `sha256:${string}` }>;
  readContract(): Promise<{ hash: `sha256:${string}` | null }>;
  writeContract(hash: `sha256:${string}`): Promise<void>;
  close(): Promise<void>;
}

export async function connectAdmin(url: string): Promise<AdminConnection> { /* ... */ }
```

### Postgres session setup (on connect)
- `SET lock_timeout = '5s'`
- `SET statement_timeout = '5min'`
- `SET idle_in_transaction_session_timeout = '60s'`
- `SET client_min_messages = 'warning'`
- (optional) `SET search_path = quote_ident(<schema>)`

### Advisory lock
- Use a stable key like `hashtext(current_database() || '') # hashtext(schema || '') # hashtext('prisma:migrate')`.
- `SELECT pg_advisory_lock(<key>)` before, `pg_advisory_unlock` after.

### Contract marker
- On `readContract()`: if table missing → `{hash:null}` and a flag in memory (hasMarker=false).
- On first write in a script, ensure `CREATE TABLE IF NOT EXISTS prisma_contract (…)` then UPSERT.

### Script execution
- Accept a Script AST (see below), segment by transactional flag.
- Render SQL chunks, concatenate with `;\n`, stream to DB inside BEGIN/COMMIT blocks where allowed.
- Return the full SQL + parameter list + sqlHash (sha256).

---

## 2) DDL / Script AST (transaction-aware)

### Why separate from the query DSL?
- You need multi-statement scripts, BEGIN/COMMIT blocks, and DDL semantics (some non-transactional).

### Minimal types

```typescript
export type ScriptAST = {
  type: 'script';
  statements: StatementAST[];
};

export type StatementAST =
  | TxBlockAST
  | DdlAST
  | RawStmtAST;

export type TxBlockAST = {
  type: 'tx';
  statements: DdlAST[]; // only transactional-safe statements allowed inside
};

export type DdlAST =
  | { type: 'createTable'; name: Ident; columns: ColumnSpec[]; constraints?: ConstraintSpec[]; ifNotExists?: boolean }
  | { type: 'dropTable'; name: Ident; ifExists?: boolean }
  | { type: 'alterTable'; name: Ident; alters: TableAlterSpec[] }
  | { type: 'createIndex'; name: Ident; table: Ident; columns: IndexCol[]; unique?: boolean; concurrently?: boolean }
  | { type: 'dropIndex'; name: Ident; ifExists?: boolean; concurrently?: boolean }
  | { type: 'addConstraint'; table: Ident; spec: ConstraintSpec }
  | { type: 'dropConstraint'; table: Ident; name: Ident };

export type RawStmtAST = {
  type: 'raw';
  template: TemplatePiece[];  // reuse your safe raw templating
  intent?: 'ddl'|'read'|'write';
};

export type Ident = { name: string }; // quoted per dialect
export type ColumnSpec = {
  name: string;
  type: 'int4'|'int8'|'text'|'varchar'|'bool'|'timestamptz'|'timestamp'|'float8'|'float4'|'uuid'|'json'|'jsonb';
  nullable: boolean;
  default?: { kind:'autoincrement'|'now'|'literal'; value?: string };
};
export type ConstraintSpec =
  | { kind: 'primaryKey'; columns: string[]; name?: string }
  | { kind: 'unique'; columns: string[]; name?: string }
  | { kind: 'foreignKey'; columns: string[]; ref: { table: string; columns: string[] }; name?: string; onDelete?: FKAction; onUpdate?: FKAction };

export type TableAlterSpec =
  | { kind:'addColumn'; column: ColumnSpec }
  | { kind:'dropColumn'; name: string }
  | { kind:'alterColumn'; name: string; setNotNull?: true; dropNotNull?: true; setType?: ColumnSpec['type']; setDefault?: ColumnSpec['default']; dropDefault?: true };

export type IndexCol = { name: string; opclass?: string; order?: 'asc'|'desc'|undefined };
export type FKAction = 'noAction'|'restrict'|'cascade'|'setNull'|'setDefault';
```

Keep this MVP-small; you can extend nodes as the planner emits more shapes.

---

## 3) Postgres lowerer (opset → Script AST → SQL)

You'll wire this later to the runner; for now, define clear boundaries so the runner can proceed.

### Lowerer interfaces

```typescript
import type { OpSet } from '@migrate-pkg';

export interface DialectLowerer {
  target: 'postgres';
  lower(opset: OpSet): ScriptAST;
}

export function pgLowerer(): DialectLowerer { /* ... */ }
```

### Lowering rules (MVP)
- **Canonical plan**: produce one ScriptAST with:
  - a tx block for transactional DDL (most ops),
  - standalone non-tx statements for CREATE/DROP INDEX CONCURRENTLY if you support those.
- **Identifiers**: schema-qualify and quote everything.
- **Defaults**: translate now to now(); autoincrement to SERIAL/identity if you choose (or defer; planner can emit concrete types).
- **ALTER COLUMN safety**: only allow simple flips (set/drop not null, set/drop default, set type if convertible). Reject or require RawStmtAST for exotic cases.

### SQL rendering
- Reuse your existing raw templating + quoteIdent + placeholder machinery.
- `renderScript(script)` returns { sql, params, sqlHash }.
- The runner only needs this function via AdminConnection.executeScript.

---

## 4) Build order & tasks (tight, independent)

### Phase A — AdminConnection
- Implement `connectAdmin()` for Postgres using pg.
- Add session guards (timeouts, search_path).
- Implement `withAdvisoryLock(key, f)`.
- Implement `readContract()` + `writeContract()`.
- Stub `executeScript(script)` (accepts a single SQL string initially).

### Phase B — Script AST + renderer
- Define ScriptAST & friends (above).
- Implement `renderScript(script, dialect='postgres')`:
  - Render tx blocks as `BEGIN; ... COMMIT;`.
  - Render DDL nodes.
  - Support RawStmtAST via your safe template engine.
  - Compute sqlHash (sha256 of SQL + params canonical form).

### Phase C — Postgres lowerer (MVP)
- Define DialectLowerer and `pgLowerer()`.
- Map minimal ops:
  - addTable → createTable
  - addColumn/alterColumn
  - addUnique/addForeignKey/addIndex
- Wrap all in a single tx block (no CONCURRENTLY in MVP).

### Phase D — Integrate with Runner slice
- Wire AdminConnection.executeScript to renderScript and pg execution.
- Add tests with a temporary Postgres container (or sqlite-in-mem if you stub).
- Golden SQL snapshot tests for the renderer.

---

## 5) Tests (minimal but meaningful)
- **AdminConnection**
  - creates single session; advisory lock blocks concurrent apply (simulate).
  - writes & reads prisma_contract.
- **Renderer**
  - "createTable" snapshot equals expected SQL.
  - tx block wraps statements; no nested BEGINs.
- **Lowerer**
  - opset.addColumn → expected DDL nodes → expected SQL.
  - round-trip: opset → script → SQL hash stable (golden).

---

## 6) DX & safety defaults
- **Strict-by-default in prod**: the runner should reject mode:'tolerant' unless opt-in.
- **No multi-statement raw by default** (reject ; inside RawStmtAST unless annotated).
- **All identifiers quoted**; all values parameterized (even for DDL where applicable).
- **Render preview**: easy renderScript output for migrate preview.

---

This is everything you need to start the runner slice confidently: a compact admin executor, a small but expressive DDL Script AST, and a lowerer boundary. You can stub planner output and still exercise the full migration flow end-to-end.
