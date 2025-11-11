## PGVector Extension Pack (Domain: SQL; Layers: targets+adapters; Planes: migration+runtime)

### Context
We want to validate that the system supports true extension packs that ship outside core/family packages and plug into well‑defined join points: authoring, targets (ops + types), lanes (op exposure is automatic via registry), runtime (codecs), and migration tooling (DDL hooks). PGVector is a great candidate: new scalar `vector`, distance/similarity operations, optional index DDL, and `CREATE EXTENSION` bootstrap.

### Goals
- Ship `@prisma-next/ext-pgvector` under `packages/extensions/sql/pgvector` as a standalone pack.
- Contribute:
  - SQL Targets: vector type + operations manifests (lowering templates).
  - Runtime: codecs for vector I/O (array<number> or Float32Array) plus annotation hints.
  - Migration: hooks to emit `CREATE EXTENSION IF NOT EXISTS vector` and optional IVFFLAT index ops.
- Acceptance: write vector queries via DSL/ORM → produce valid Plans → lower to SQL → execute via Postgres adapter → decode results via codecs. (Execution can be gated behind CI env; lowering/unit tests are required.)

### Domain / Layer / Plane
- Domain: sql
- Layers: targets (ops/types), adapters (codecs); optional tooling hooks for migration plane
- Planes: migration (emitter/planner hooks) and runtime (codecs/ops registry)

### Filesystem
```
packages/extensions/sql/pgvector/
  package.json
  README.md
  src/
    index.ts                    // entry: exports manifest + codecs + (optional) planner hooks
    manifest.ts                 // ExtensionPackManifest (targetFamily: 'sql', ops, types)
    codecs.ts                   // runtime codecs for vector
    sql/
      operations.ts            // op manifests + lowering templates
      contract-types.ts        // vector scalar type declaration (types-only mapping)
      migration-hooks.ts       // optional: CREATE EXTENSION + index DDL hooks
  test/
    lowering.test.ts           // manifests lower to expected SQL
    codecs.test.ts             // encode/decode roundtrip
    dsl-usage.test.ts          // smoke tests building vector ops via lanes (no API changes)
```

### Integration Points (no core changes)
- Emitter: already hook‑based, resolves packs by targetFamily. Ensure CLI/tooling loads `@prisma-next/ext-pgvector` into the pack list for emission.
  - Note: the npm package name is `@prisma-next/ext-pgvector`; internal docs may refer to “pgvector pack”.
- Operation registry: assembly accepts packs.manifest.operations (relational‑core attaches these to columns by typeId); add the vector ops there.
- Runtime: context aggregates adapter codecs + pack codecs. Register pgvector codecs alongside adapter profile codecs.
- Planner: Framework Tooling calls family planner hooks; packs can contribute migration hooks via a known signature (see below) so the SQL planner can `CREATE EXTENSION` when vector types appear in diffs.

### Manifests (targets layer)
`src/sql/operations.ts`
```ts
import type { OperationSignature } from '@prisma-next/operations';

export const vectorOps: OperationSignature[] = [
  {
    forTypeId: 'pgvector/vector@1',
    method: 'cosineSimilarity',
    args: [ { kind: 'typeId', type: 'pgvector/vector@1' } ],
    returns: { kind: 'builtin', type: 'number' },
    lowering: { targetFamily: 'sql', strategy: 'function', template: 'cosine_similarity({self},{0})' },
  },
  {
    forTypeId: 'pgvector/vector@1',
    method: 'l2Distance',
    args: [ { kind: 'typeId', type: 'pgvector/vector@1' } ],
    returns: { kind: 'builtin', type: 'number' },
    lowering: { targetFamily: 'sql', strategy: 'infix', template: '{self} <-> {0}' },
  },
  // add innerProduct if desired
];
```

`src/sql/contract-types.ts` (types-only mapping)
```ts
export type PgVectorScalarToJs = {
  'pgvector/vector@1': number[]; // or Float32Array for runtime decode
};
```

### Codecs (runtime layer)
`src/codecs.ts`
```ts
import type { Codec } from '@prisma-next/sql-target';

export const vectorCodec: Codec = {
  id: 'pgvector/vector@1',
  toDriver(value: number[] | Float32Array) {
    // implement as needed for pg; a simple array → pgvector input formatter
    return value;
  },
  fromDriver(value: unknown) {
    // map driver row value to number[]
    if (Array.isArray(value)) return value as number[];
    if (typeof value === 'string') return value.split(',').map(Number);
    return [] as number[];
  },
};

export const codecs = [vectorCodec];
```

### Migration Hooks (tooling)
`src/sql/migration-hooks.ts`
```ts
export interface SqlMigrationHookContext { usesVector: boolean; }
export function sqlPreflight(ctx: SqlMigrationHookContext) {
  if (ctx.usesVector) {
    return [{ kind: 'raw', sql: 'CREATE EXTENSION IF NOT EXISTS vector;' }];
  }
  return [];
}
```
Framework planner collects hooks from packs and includes preflight ops when diffs reference vector columns.

### ExtensionPack entry
`src/manifest.ts`
```ts
export const pgvectorPack = {
  id: 'pgvector',
  targetFamily: 'sql',
  meta: {
    packageName: '@prisma-next/ext-pgvector',
    family: 'sql',
    dialects: ['postgres'],
    type: 'extension-pack'
  },
  operations: vectorOps,
  codecs,
  // optional: planner hooks, types-only mappings for .d.ts generation
} as const;
```

`src/index.ts`
```ts
export { pgvectorPack } from './manifest';
```

### Wiring / Config
- Tooling/CLI: allow listing packs in `prisma-next.config.ts`.
- Emitter/Operation registry assembly: include packs when building contract.d.ts and lanes operation registry.
- Runtime context: include pack.codecs() when composing codec registry.

### Tests / Acceptance
- Lowering tests: building a simple lane query calling `.cosineSimilarity()` produces SQL with `cosine_similarity(self, other)` and with `<->` for L2.
- Codec tests: vector encode/decode roundtrip (string/array based on driver return type).
- DSL/ORM smoke: use vector ops in where/orderBy; produce valid Plans; lower to SQL.
- Optional: migration preflight adds `CREATE EXTENSION vector` when diff introduces vector columns.

### Guardrails
- Domain: sql; Layers: targets (ops/types), adapters (codecs); migration hooks consumed by framework tooling.
- No imports from packs into framework core beyond the documented SPI.

### Out of Scope (initial)
- Advanced IVFFLAT index DDL planning (can be a follow‑up once basic pack scaffolding is merged).
- End‑to‑end execution CI (lowering/unit tests are sufficient if CI env lacks pgvector).

### Relationship to Parameterized Types

You do not need to complete Slice 10 (Parameterized Types) before shipping this pack. Use a phased approach:

- Phase 1 (pre‑Slice 10): treat `vector` as a plain typeId (`'pgvector/vector@1'`). Carry the column dimension as a deterministic extension annotation (e.g., `extensions.pgvector.dim: 1536`) in the contract. Runtime codecs validate length; DDL lowering uses the annotation for `VECTOR(1536)`.
- Phase 2 (post‑Slice 10): migrate `vector` to a structured parameterized type (`{ id: 'pgvector/vector@1', params: { dim: 1536 } }`). Keep the same JS `CodecTypes['pgvector/vector@1'].output`. Update manifests to declare a param schema and deprecate the annotation.

The pack’s tests should accept both representations during the migration window; canonicalization rules will prefer the structured form once Slice 10 lands.

### Migration Checklist (pre‑10 → post‑10)

- Contract acceptance:
  - Accept vector dimension via deterministic annotation (e.g., `extensions.pgvector.dim`) pre‑10.
  - Accept structured `{ id: 'pgvector/vector@1', params: { dim } }` post‑10.
- Canonicalization:
  - Prefer structured form once Slice 10 is enabled; continue reading annotation during a transition period.
- Runtime codecs:
  - Validate vector length using either annotation or params; error messages should reference the effective `dim` consistently.
- DDL lowering:
  - Use annotation or params to render `VECTOR(dim)`; ensure both paths produce identical SQL for the same `dim`.
- Tests:
  - Add fixtures for both encodings; a test flag (or helper) toggles pre‑10 vs post‑10 expectations.
  - Ensure downgrade stability — converting structured params back to annotation remains deterministic (for a limited window).
- Deprecation:
  - Mark annotation as deprecated once Slice 10 ships; add a lint hint guiding authors to the structured form.
