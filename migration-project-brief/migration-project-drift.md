# Migration Project Drift Detection

In our model, drift is "the remote DB's actual schema ≠ the PSL-derived contract B (and ≠ the last applied migration's to)". Here's a focused, minimal plan to detect, explain, and remediate drift that fits the prototype and our safety-first defaults.

---

## What kinds of drift?

1. **Contract drift (version drift)**
   `prisma_contract.contract_hash` on the DB ≠ desired `contract.json.contractHash`.
   (DB may be behind, ahead, or on a fork.)

2. **Structural drift**
   The actual catalog (tables/columns/indexes/FKs) differs from the contract A the DB claims to be at (e.g., a hotfix ALTER was applied manually).

We'll handle (1) cheaply and (2) only when asked (because it requires reading full catalog).

---

## Minimal concepts we'll add

### 1) Catalog fingerprint (structural hash)

A stable, canonical JSON of the database catalog we care about:

```typescript
type Catalog = {
  target: 'postgres',
  tables: Record<string, {
    columns: Record<string, { type: ColumnType; nullable: boolean; default?: DefaultSpec }>;
    primaryKey?: string[];
    uniques?: Array<{ columns: string[]; name?: string }>;
    indexes?: Array<{ columns: string[]; name?: string; method?: 'btree' }>;
    foreignKeys?: Array<{ columns: string[]; ref:{ table:string; columns:string[] }; name?: string }>;
  }>;
}
type CatalogHash = `sha256:${string}`;
```

- AdminConnection gets one method:

```typescript
readCatalog(): Promise<{ catalog: Catalog; hash: CatalogHash }>
```

### 2) Drift report

```typescript
type DriftReport = {
  mode: 'strict'|'tolerant';
  desiredHash: `sha256:${string}`;        // from prisma/contract.json
  dbContract: `sha256:${string}` | null;  // from prisma_contract
  dbCatalogHash: CatalogHash;             // live structural hash
  classification: 'inSync'|'behind'|'ahead'|'fork'|'unknown';
  structural: 'matchesContract'|'differsFromContract'|'unknown';
  summary: string;                        // human-readable one-liner
  actions: Array<'fastForward'|'trimAndApply'|'replanFromLive'|'mark'|'fail'>;
  details?: {                             // optional verbose section
    missingTables?: string[];
    extraTables?: string[];
    columnDiffs?: Array<{ table:string; column:string; a?: any; b?: any }>;
    indexDiffs?: any[];
    fkDiffs?: any[];
  };
}
```

---

## Minimal UX (commands)

- `migrate status --env <name>`
  - Reads desired B = prisma/contract.json.contractHash
  - Reads DB's dbContract (or null) + optional dbCatalogHash if --deep
  - Classifies drift and prints actions.

- `migrate apply --env <name> [--mode strict|tolerant]`
  - **strict** (default in prod): only apply a program when dbContract == meta.from.hash.
    If not, fail with drift report.
  - **tolerant** (dev/staging): allow "trim" of an opset (skip already-satisfied ops) when dbContract is ahead OR catalog already satisfies some ops.

- `migrate replan --from-live`
  - Reads live catalog as A_live.
  - Plans A_live → B using the planner (same deterministic rules) → writes a repair program (from = dbCatalogHash or from = dbContract? see below).
  - You then review and migrate apply.

- `migrate mark --hash sha256:<H>`
  - Advanced: set prisma_contract.contract_hash = H (adopt/override).
  Only allowed when --force and after an explicit structural match check.

---

## Classification logic (cheap → deep)

1. **Cheap pass (always)**:
   - desired = B.contractHash
   - dbContract = readContract() (null if marker missing)
   - If dbContract == desired: inSync.
   - If dbContract is null: unknown.

2. **Deep pass (when --deep or we hit mismatch)**:
   - A_claimed = contract for dbContract if we can resolve it (i.e., we have that historical contract on disk); else A_claimed = unknown.
   - dbCatalog = readCatalog(); dbCatalogHash
   - Compare dbCatalog vs A_claimed:
     - If equal → structural: matchesContract (version drift only).
     - Else → structural: differsFromContract (true structural drift).

3. **Behind/ahead/fork (using migration graph)**:
   - If there exists a path in migration programs from dbContract → desired: behind (fast-forward).
   - If there exists a path from desired → dbContract: ahead (you're beyond desired; usually staging/dev).
   - Otherwise: fork (branch).

---

## Remediation strategies (MVP)

### A) Fast-forward (best case)
- **When**: dbContract exists and there's a from=dbContract → ... → to=desired path.
- **Action**: apply programs in order using strict mode.
- **Notes**: no structural catalog read necessary.

### B) Trim & apply (tolerant)
- **When**: You have the correct next program A → A', but the live catalog already satisfies some subset of ops (e.g., a teammate ran part of it).
- **Action**: at apply-time in tolerant mode, compile opset, skip satisfied operations, and still land at to = A'.
- **This requires** a quick check function: isSatisfied(op, dbCatalog).
- **Safety**: disallow in prod by default; allow only additive ops to be skipped (no destructive ops in MVP anyway).

### C) Replan from live (repair)
- **When**: Structural drift or branch (no linear path).
- **Action**: migrate replan --from-live
- **Read** A_live = dbCatalog.
- **Plan** A_live → B with our MVP planner (additive-only).
- **If** B < A_live (drops/renames/casts), the MVP planner will fail with instructions (that's fine; you can later add hints).
- **Write** repair program:

```json
// meta.json
{
  "from": { "kind": "contract", "hash": "<dbContract or 'anyOf':[dbContract, dbCatalogHash]>" },
  "to":   { "kind": "contract", "hash": "<desiredHash>" },
  ...
}
```

- **Recommendation**: for MVP, keep from.kind = 'contract' using the declared dbContract (not catalogHash) to stay consistent with versioning, and rely on tolerant apply to skip satisfied ops if needed.
- **Apply** the repair program (strict in prod, tolerant in dev).

### D) Mark (adopt)
- **When**: The live catalog already equals desired, but prisma_contract is missing/wrong.
- **Action**: migrate mark --hash desired
- **Precondition**: readCatalog() == contractB structurally (or user passes --force).
- **Then** write the marker only (no DDL).

---

## Runner additions (small)
- AdminConnection.readCatalog()
  - Query information_schema + pg_catalog to produce Catalog.
  - Canonicalize (sort keys). Hash to CatalogHash.
- isSatisfied(op: Op, catalog: Catalog): boolean
  - addTable satisfied if table exists with superset of specified columns/PK.
  - addColumn satisfied if column exists with compatible spec (MVP: exact type/nullable/default match).
  - addUnique/addIndex/addForeignKey satisfied if an equivalent exists.
  - Keep this strict in MVP to avoid masking subtle mismatches.
- In tolerant mode, when applying a program:
  - Load dbCatalog.
  - Filter ops by !isSatisfied(op, dbCatalog).
  - If all ops satisfied → return {applied:false, reason:'noop'} but still update prisma_contract to the program to.hash (this is the "skip but version" behavior).
  - Else run as usual.

---

## CLI messages (clear & actionable)

### Case: behind

```
production: DB sha256:A, desired sha256:C
Pending migrations:
  - 2025-10-13 A→B
  - 2025-10-18 B→C
Action: pn prisma-next migrate apply  # will fast-forward strictly
```

### Case: structural drift

```
staging: DB claims sha256:B but live catalog differs from B
Details:
  - user.active default mismatch
  - missing index user_email_idx
Recommended:
  - pn prisma-next migrate replan --from-live
    (will plan A_live→desired with additive ops)
```

### Case: adopt

```
development: no contract marker found; live catalog equals desired sha256:C
Action: pn prisma-next migrate mark --hash sha256:C
```

### Case: fork

```
staging: DB at sha256:X; desired sha256:C; no linear path found
Options:
  - replan from live: pn prisma-next migrate replan --from-live
  - or revert/align staging to a known contract and re-apply
```

---

## Safety defaults
- **Prod**: --mode strict enforced; tolerant forbidden unless --allow-tolerant.
- **Mark**: require structural equality in prod (no --force).
- **Trim**: only skip additive ops (we only have additive ops in MVP planner anyway).
- **Advisory lock** around everything.
- **Ledger** (optional later): append { programId, from, to, sqlHash, pre/post catalog hashes } to a prisma_migration_ledger.

---

## Tests to add
1. **status**: classify inSync, behind, unknown, fork with synthetic graphs.
2. **trim** (tolerant apply): ops already satisfied → no DDL, contract updated.
3. **replan from live**: A_live missing an index; plan produces addIndex; apply updates contract.
4. **adopt** (mark): catalog == desired → mark succeeds; catalog != desired → mark fails in prod.

---

## TL;DR
- **Start simple**: detect hash mismatch; optionally read live catalog to diagnose structural drift.
- **Provide three levers**:
  1. fast-forward (strict) when on the linear path,
  2. trim (tolerant) when some ops already applied,
  3. replan from live (repair) when you're on a branch or structurally off.
- **Keep prod strict**, and make "mark" require structural equality.

