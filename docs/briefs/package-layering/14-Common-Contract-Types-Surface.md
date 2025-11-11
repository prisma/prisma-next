## Slice 14 — Shared Contract Types and IR Factories (Domain: Architecture, Layer: docs, Plane: migration)

### Context
We need a single, shared‑plane surface for SQL family contract types and validators to stop runtime→migration imports and remove dep‑cruise exceptions. In parallel, node construction for contract IR is duplicated across tests (framework and SQL family). Introducing well‑scoped IR factories will DRY tests and make emitters/validators easier to exercise without hand‑rolled objects.

This slice establishes:
- A SQL family package mirroring the framework’s `core-contract` layout, but for SQL: types, validators, and SQL‑specific IR factories in the shared plane.
- Family‑agnostic IR factories in the framework’s tooling to construct `ContractIR` payloads for tests and emitters (no family specifics), avoiding upward imports from authoring.

### Rationale and Prior Pain
- Runtime imported migration‑plane packages for type information. This violated plane rules and forced dep‑cruise exceptions.
- Test code across emitter and authoring duplicated large IR literals, making changes brittle and hard to review.
- SQL family types lived under a “targets” package, which implied migration plane and caused authoring→targets upward dependencies.
- Framework and SQL domains diverged in structure, increasing cognitive load for contributors.

This slice makes structure and flow predictable: shared types/validators in a dedicated SQL family package (shared plane), emitter‑oriented factories in framework tooling, and normalized SQL IR factories where they belong.

### Decisions (locked)
- Package name/path (SQL, shared plane): `@prisma-next/sql-contract` at `packages/sql/contract`.
- Types source: Move SQL contract type aliases from `packages/targets/sql/contract-types` into `packages/sql/contract/src/types.ts`. Keep `@prisma-next/sql-contract-types` as a transitional re‑export until all imports are updated.
- Validators: Implement Arktype validators in `packages/sql/contract/src/validators.ts` (side‑effect free).
- SQL IR factories: Implement in `packages/sql/contract/src/factories.ts` (pure, normalized builders for storage/tables/columns/models/relations/mappings/contracts).
- Family‑agnostic IR factories: Implement in `packages/framework/tooling/emitter/src/factories.ts` and export as a public test helper. Rationale: `ContractIR` is part of the emitter surface; placing factories in tooling avoids an upward import from authoring to tooling.
- Framework package boundaries remain: `framework/core-contract` stays family‑agnostic; `framework/authoring/contract-authoring` remains the generic builder DSL without importing tooling; `framework/authoring/contract-ts` is a thin TS‑first helper layer (no family specifics).

### Related Framework Packages (for clarity)
- `packages/framework/core-contract` (shared plane): target‑agnostic base contract and plan types. No SQL specifics.
- `packages/framework/authoring/contract-authoring` (migration plane): generic builder DSL and normalization (ContractBuilder/ModelBuilder/TableBuilder).
- `packages/framework/authoring/contract-ts` (migration plane): thin TS‑first helpers around `contract-authoring` (currently minimal surface).

### Goals
1. Provide side‑effect‑free SQL contract declarations, validators, and SQL IR factories in the shared plane.
2. Provide family‑agnostic `ContractIR` factories in framework tooling for tests and emitters.
3. Keep artifact generation (`contract.json`) in the app pipeline; runtime ingests data, not code.
4. Resolve dependency violations around contract packages and remove related dep‑cruise exceptions.

### Deliverables
- `packages/sql/contract` (shared plane)
  - `src/types.ts`: SQL family contract types (moved from `targets/sql/contract-types`).
  - `src/validators.ts`: Arktype validators for structural checks.
  - `src/factories.ts`: IR builders for SQL storage/models/relations/mappings/contracts.
  - `src/exports/{types,validators,factories}.ts`: barrel exports mirroring framework style.
- `packages/framework/tooling/emitter/src/factories.ts`
  - Family‑agnostic `ContractIR` factories (headers/meta/capabilities/extensions), accepting family sections as generic payloads.
- Transitional re‑export in `@prisma-next/sql-contract-types` with a deprecation note.
- Updated imports in authoring/emitter/lanes/runtime to point to `@prisma-next/sql-contract` (types/validators/factories) or the emitter factories for `ContractIR`.
- Dep‑cruise config updated; exceptions for contract packages removed when green.

### Before/After: Import Path Matrix
- Authoring (SQL):
  - Before: `@prisma-next/sql-contract-types`
  - After: `@prisma-next/sql-contract/exports/types` (+ optional `exports/validators` for JSON validation helpers)
- Emitter (SQL):
  - Before: `@prisma-next/sql-contract-types`, ad‑hoc `ContractIR` literals in tests
  - After: `@prisma-next/sql-contract/exports/types|validators` and `@prisma-next/emitter/factories` for IR wrappers
- Lanes/Runtime (SQL):
  - Before: may import `@prisma-next/sql-contract-types` (migration plane) for compile‑time types
  - After: `@prisma-next/sql-contract/exports/types` only; runtime ingests `contract.json` and validates via `exports/validators`
- Extensions (compat/adapters):
  - Before: may import `sql-contract-types`
  - After: `@prisma-next/sql-contract/exports/types|validators`; no migration‑plane imports

### Package Contents (authoritative)

1) `packages/sql/contract/src/types.ts`
- Export only type aliases; depend on `@prisma-next/contract/types` for `ContractBase`.
- Types: `StorageColumn`, `PrimaryKey`, `UniqueConstraint`, `Index`, `ForeignKeyReferences`, `ForeignKey`, `StorageTable`, `SqlStorage`, `ModelField`, `ModelStorage`, `ModelDefinition`, `SqlMappings`, `SqlContract<S,M,R,Map>`, `ExtractCodecTypes<T>`, `ExtractOperationTypes<T>`.

2) `packages/sql/contract/src/validators.ts`
- Arktype validators for: `StorageColumn`, `PrimaryKey`, `UniqueConstraint`, `Index`, `ForeignKeyReferences`, `ForeignKey`, `StorageTable`, `SqlStorage`, `ModelField`, `ModelDefinition`, `SqlContract`.
- Helpers: `validateSqlContract(value)`, `validateStorage(value)`, `validateModel(value)`; throw with aggregated messages on failure.

3) `packages/sql/contract/src/factories.ts` (SQL IR builders)
- Pure, normalized builders:
  - `col(typeId: string, nullable = false): StorageColumn`
  - `pk(...cols: string[]): PrimaryKey`
  - `unique(...cols: string[]): UniqueConstraint`
  - `index(...cols: string[]): Index`
  - `fk(cols: string[], refTable: string, refCols: string[], name?: string): ForeignKey`
  - `table(columns: Record<string, StorageColumn>, opts?: { pk?: PrimaryKey; uniques?: UniqueConstraint[]; indexes?: Index[]; fks?: ForeignKey[] }): StorageTable` (arrays default to empty)
  - `model(table: string, fields: Record<string, { column: string }>, relations: Record<string, unknown> = {}): ModelDefinition`
  - `storage(tables: Record<string, StorageTable>): SqlStorage`
  - `contract(opts: { target: string; coreHash: string; storage: SqlStorage; models?: Record<string, ModelDefinition>; relations?: Record<string, unknown>; mappings?: Partial<SqlMappings>; schemaVersion?: '1'; targetFamily?: 'sql'; profileHash?: string; capabilities?: Record<string, Record<string, boolean>>; extensions?: Record<string, unknown>; meta?: Record<string, unknown>; sources?: Record<string, unknown> }): SqlContract`

4) `packages/framework/tooling/emitter/src/factories.ts` (family‑agnostic `ContractIR`)
- Builders for emitter IR envelope (no SQL specifics):
  - `irHeader({ target, targetFamily, coreHash, profileHash? })`
  - `irMeta({ capabilities?, extensions?, meta?, sources? })`
  - `contractIR<TStorage, TModels, TRelations>({ header, meta, storage, models, relations }): ContractIR`
- Usage: compose SQL sections created via SQL factories with generic IR envelope for emitter tests.

### Example Usage (sketches)
SQL IR factories (builders):
```
import { col, table, storage, model, contract } from '@prisma-next/sql-contract/exports/factories';

const userTable = table(
  {
    id: col('pg/int4@1'),
    email: col('pg/text@1'),
  },
  { pk: { columns: ['id'] }, uniques: [{ columns: ['email'] }] }
);

const s = storage({ user: userTable });
const m = { User: model('user', { id: { column: 'id' }, email: { column: 'email' } }) };

const c = contract({ target: 'postgres', coreHash: 'sha256:...', storage: s, models: m });
```

Emitter IR factories:
```
import { contractIR, irHeader, irMeta } from '@prisma-next/emitter/factories';
import { storage, model } from '@prisma-next/sql-contract/exports/factories';

const header = irHeader({ target: 'postgres', targetFamily: 'sql', coreHash: 'sha256:...' });
const meta = irMeta({ capabilities: { sql: { returning: true } } });

const ir = contractIR({ header, meta, storage: /* SqlStorage */ s, models: /* models */ m, relations: {} });
```

Validation:
```
import { validateSqlContract } from '@prisma-next/sql-contract/exports/validators';
validateSqlContract(c); // throws on structural mismatch
```

### Migration Plan (no open questions)
1. Create `packages/sql/contract` with types/validators/factories and exports barrels.
2. Move type aliases from `packages/targets/sql/contract-types/src/index.ts` → `packages/sql/contract/src/types.ts`.
3. Convert `@prisma-next/sql-contract-types` to a transitional re‑export of `@prisma-next/sql-contract/exports/types` and add a deprecation notice in its README.
4. Add `framework/tooling/emitter/src/factories.ts` and export factories via the emitter’s public API for tests.
5. Update imports:
   - Authoring (`packages/sql/authoring/sql-contract-ts`) → `@prisma-next/sql-contract/exports/types` (and optionally validators for JSON validation helper).
   - SQL emitter (`packages/targets/sql/emitter`) → SQL types/validators from `@prisma-next/sql-contract/exports/*`; use emitter factories for `ContractIR` where applicable.
   - Lanes/runtime: compile‑time type imports, if any, switch to `@prisma-next/sql-contract/exports/types`. Runtime continues to ingest `contract.json` and can validate via `validateSqlContract` when needed.
6. Refactor tests:
   - Replace ad‑hoc IR literals with SQL factories + emitter IR factories; keep a few negative literal cases.
7. Dependency Cruiser:
- Add `packages/sql/contract/**` as SQL domain, layer `core`, plane `shared`.
- Remove exceptions once imports are updated:
  - Authoring→Targets (was for types)
  - Runtime/Extensions→Targets (use shared validators/types and artifact injection)
- Run `pnpm lint:deps`; resolve any stragglers.
8. Delete transitional `@prisma-next/sql-contract-types` once grep shows no imports.

### Acceptance Criteria
- `@prisma-next/sql-contract` exists (shared plane) with types, validators, SQL IR factories; zero side effects.
- Family‑agnostic `ContractIR` factories are available from the emitter tooling package and used by tests.
- All packages import SQL types/validators from `@prisma-next/sql-contract`; runtime does not import migration plane code.
- Dep‑Cruiser passes with contract‑related exceptions removed.

### Notes
- Keep factories/validators deterministic and side‑effect free so both planes can import them.
- Do not emit artifacts from repo packages; apps generate `contract.json` via CLI/CI and pass it to runtime.

### Risks and Mitigations
- Wide import churn across packages → Stage changes by domain (authoring → emitter → lanes/runtime) with dep‑cruise gating after each step.
- Validators diverge from emitter assumptions → Align defaults with normalization rules; add shared fixtures that both validators and emitter tests consume.
- Residual runtime → migration imports → Run focused dep‑cruise in CI and on lint‑staged; block merges until green.

### Rollout Milestones
- M1: Create `sql/contract` (types, validators, factories); transitional re‑export added.
- M2: Update authoring and emitter to use `sql/contract`; refactor emitter tests to factories.
- M3: Update lanes/runtime and extensions; validate contracts at boundaries with shared validators.
- M4: Remove dep‑cruise exceptions; delete transitional re‑export; docs refreshed.
