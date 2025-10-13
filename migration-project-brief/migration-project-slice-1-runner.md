# Migration Project Slice 1: Runner

This is the overall breakdown of the migration system.
- Planner (diff PSL A→B, produce deterministic opset.json)
- Runner (apply packages to a DB safely)
- Package definition library (read/write/validate meta.json + opset.json, hashing, applicability)

In this slice we will focus on the runner + package definition library and exclude the planner. Below is a tight architecture that you can implement independently of the planner.

---

## Scope for this slice

### What we will build now
- Package format contracts (types, validators)
- Reader/Writer for migration packages
- Applicability logic (from matching, strict/tolerant modes)
- Runner:
  - Select next applicable migration
  - Lower opset.json to a DDL Script (using a dialect lowerer you inject)
  - Execute safely on an AdminConnection (advisory lock, tx segmentation)
  - Update prisma_contract with to.hash
  - Return an execution report

### What we will not build now
- The Planner (assume opset.json arrives)
- The Lowerer implementation (you'll inject a Postgres lowerer stub for now)
- Complex drift handling / replan (leave a hook)

---

## Package definition library

### File layout (per migration)

```
migrations/<id>/
  meta.json
  opset.json
  notes.md        # optional
```

### meta.json schema (final form)

```typescript
type ContractRef =
  | { kind: 'contract'; hash: `sha256:${string}` }
  | { kind: 'empty' }
  | { kind: 'unknown' }
  | { kind: 'anyOf'; hashes: Array<`sha256:${string}`> };

type Meta = {
  id: string;                  // folder name is fine
  target: 'postgres';          // future: 'mysql' | 'sqlite' …
  from: ContractRef;
  to: { kind: 'contract'; hash: `sha256:${string}` };
  opSetHash: `sha256:${string}`;
  mode?: 'strict' | 'tolerant'; // default 'strict'
  supersedes?: string[];        // optional audit trail
  notes?: string;
};
```

### opset.json schema (MVP)

Keep it small and deterministic; you can extend later.

```typescript
type OpSet = {
  version: 1;
  operations: Array<
    | { kind: 'addTable'; table: string; columns: Record<string, ColumnSpec>; primaryKey?: string[] }
    | { kind: 'dropTable'; table: string }
    | { kind: 'addColumn'; table: string; column: string; spec: ColumnSpec }
    | { kind: 'alterColumn'; table: string; column: string; alter: ColumnAlterSpec }
    | { kind: 'addUnique'; table: string; columns: string[]; name?: string }
    | { kind: 'addIndex'; table: string; columns: string[]; name?: string; method?: 'btree'|'hash'|'gist'|'gin' }
    | { kind: 'addForeignKey'; table: string; columns: string[]; ref: { table: string; columns: string[] }; name?: string; onDelete?: 'noAction'|'restrict'|'cascade'|'setNull'|'setDefault'; onUpdate?: same }
  >;
};

type ColumnSpec = {
  type: 'int4'|'int8'|'text'|'varchar'|'bool'|'timestamptz'|'timestamp'|'float8'|'float4'|'uuid'|'json'|'jsonb';
  nullable: boolean;
  default?: { kind:'autoincrement'|'now'|'literal'; value?: string };
};

type ColumnAlterSpec =
  | { setNotNull: true }
  | { dropNotNull: true }
  | { setDefault: { kind:'now'|'literal'; value?: string } }
  | { dropDefault: true }
  | { setType: ColumnSpec['type'] }; // v1 simple
```

Determinism: Operation order is already canonical (provided by planner). The package lib will hash the canonical JSON to validate opSetHash.

### Package library API (TypeScript)

```typescript
// packages/migrate-pkg
export interface MigrationPackage {
  dir: string;
  meta: Meta;
  ops: OpSet;
}

export interface ContractMarker {
  hash: `sha256:${string}` | null; // null = empty/unknown
}

// Read/validate a package
export function loadPackage(dir: string): Promise<MigrationPackage>;

// Compute canonical hash of opset
export function hashOpSet(ops: OpSet): `sha256:${string}`;

// Applicability
export function matchesFrom(meta: Meta, current: ContractMarker): boolean;

// Choose the next package from a list given current DB contract
export function nextApplicable(pkgs: MigrationPackage[], current: ContractMarker): MigrationPackage | null;
```

### Rules for matchesFrom:
- `{kind:'empty'}` → current.hash === null and DB has no prisma_contract row
- `{kind:'unknown'}` → marker missing (legacy DB). For prod you can forbid this.
- `{kind:'contract', hash:H}` → current.hash === H
- `{kind:'anyOf', hashes:[…]}` → current.hash ∈ set

---

## Runner

### Responsibilities
- Resolve current DB contract (SELECT contract_hash FROM prisma_contract LIMIT 1, else null)
- Select next applicable package (using package lib)
- Validate package integrity (hashOpSet(ops) equals meta.opSetHash)
- Lower ops → Script (ScriptAST) using injected dialect lowerer
- Execute script on AdminConnection (advisory lock, tx segmentation)
- Update prisma_contract with meta.to.hash
- Return a detailed ApplyReport

### Key interfaces

```typescript
// packages/migrate-runner

export interface DialectLowerer {
  target: 'postgres'; // later: union
  lower(opset: OpSet): ScriptAST;  // produces multi-stmt DDL script (with tx blocks where legal)
}

export interface AdminConnection {
  target: 'postgres';
  withAdvisoryLock<T>(key: string, f: () => Promise<T>): Promise<T>;
  executeScript(script: ScriptAST): Promise<{ sql: string; params: unknown[]; sqlHash: `sha256:${string}` }>;
  readContract(): Promise<ContractMarker>;          // read current prisma_contract or null
  writeContract(hash: `sha256:${string}`): Promise<void>;
}

export interface ApplyOptions {
  mode?: 'strict'|'tolerant'; // override meta.mode if needed
  dryRun?: boolean;           // compile-only
}

export interface ApplyReport {
  packageId: string;
  from: Meta['from'];
  to: Meta['to'];
  applied: boolean;           // false if not applicable
  reason?: 'not-applicable'|'strict-mismatch'|'noop';
  sql?: string;
  sqlHash?: `sha256:${string}`;
}
```

### Runner algorithm (single step)

```typescript
export async function applyNext(
  pkgs: MigrationPackage[],
  admin: AdminConnection,
  lowerer: DialectLowerer,
  opts: ApplyOptions = {}
): Promise<ApplyReport> {
  const current = await admin.readContract(); // {hash}|null

  const pkg = nextApplicable(pkgs, current);
  if (!pkg) return { packageId: '', from:{kind:'contract',hash:current.hash as any}, to:{kind:'contract',hash:current?.hash as any}, applied:false, reason:'not-applicable' };

  // integrity
  if (hashOpSet(pkg.ops) !== pkg.meta.opSetHash) {
    throw new Error(`opSetHash mismatch for ${pkg.meta.id}`);
  }

  // strict/tolerant decision
  const effectiveMode = opts.mode ?? pkg.meta.mode ?? 'strict';
  if (effectiveMode === 'strict' && !matchesFrom(pkg.meta, current)) {
    return { packageId: pkg.meta.id, from: pkg.meta.from, to: pkg.meta.to, applied:false, reason:'strict-mismatch' };
  }

  // lower
  const script = lowerer.lower(pkg.ops);

  // execute under advisory lock
  const { sql, params, sqlHash } = await admin.withAdvisoryLock('prisma:migrate', async () => {
    if (opts.dryRun) {
      return { sql: render(script), params: [], sqlHash: hash(render(script)) as any };
    }
    const res = await admin.executeScript(script);
    await admin.writeContract(pkg.meta.to.hash);
    return res;
  });

  return { packageId: pkg.meta.id, from: pkg.meta.from, to: pkg.meta.to, applied:true, sql, sqlHash };
}
```

Segmentation (BEGIN/COMMIT vs non-transactional DDL) is the lowerer's job; the runner just calls executeScript.

### Multi-step apply

Loop applyNext until it returns not-applicable.

---

## Safety defaults
- **Prod guard**: refuse {kind:'unknown'} and mode:'tolerant' unless an explicit --allow-… flag.
- **Advisory lock**: withAdvisoryLock uses a stable key (db+schema) to prevent concurrent applies.
- **Hash checks**: verify both opSetHash and (optionally) sqlHash before writing the contract hash.
- **Marker creation**: if table missing and the migration's from is 'empty'|'unknown', create prisma_contract in the same script as first apply.

---

## Usage from CLI layer (example)

```typescript
// load all packages on disk
const pkgs = (await glob('migrations/*'))
  .map(loadPackage)
  .sort(byIdAsc); // order doesn't matter for correctness; sort for stable UX

// connect
const admin = await connectAdmin({ url: env.DATABASE_URL });
const lowerer = pgLowerer(); // inject

// apply in a loop
for (;;) {
  const r = await applyNext(pkgs, admin, lowerer);
  if (!r.applied && r.reason === 'not-applicable') break;
  if (!r.applied && r.reason === 'strict-mismatch') {
    console.error('Strict mismatch—aborting.');
    process.exit(1);
  }
  console.log(`Applied ${r.packageId} → ${r.to.hash}`);
}
```

---

## Tests to write (fast and focused)
1. **Package validation**
   - malformed meta.json rejected
   - opSetHash mismatch throws
2. **Applicability**
   - empty DB matches {kind:'empty'}, not {kind:'contract'}
   - strict vs tolerant behavior
3. **Runner happy path**
   - Given current=A and package A→B, apply updates marker to B
4. **Non-applicable**
   - Given current=C and only A→B exists, returns not-applicable
5. **Advisory lock**
   - Ensure withAdvisoryLock wraps execution (can simulate lock reuse)
6. **Lowerer integration (stub)**
   - lowerer.lower() called with ops; runner passes through script/sqlHash

---

## Why this slice stands alone
- It gives you a runnable end-to-end apply loop with real safety guarantees.
- It defines the file format and runtime contracts other teams can build against.
- The planner can land later and simply drop opset.json into the package folders.
- Dialects can be added by supplying new lowerers; the runner need not change.

If you want, I can tighten any of these signatures into exact .ts stubs you can paste into packages/migrate-pkg and packages/migrate-runner.
