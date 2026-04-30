# M2 — `PslContractInferCapable` and CLI cleanup

**Spec:** [`../spec.md`](../spec.md) (Capability 1, A1, A2, A3)

## Goal

Introduce the `PslContractInferCapable` capability. Move all SQL→AST construction logic (Postgres type/default mapping, raw default parsing, enum extraction, relation inference) out of `psl-printer` and into the SQL family. Remove every SQL import and `familyId` branch from `inspect-live-schema.ts` and `contract-infer.ts`.

By the end of this milestone:

- The framework CLI does not import `validatePrintableSqlSchemaIR`, `PslPrintableSqlSchemaIR`, `createPostgresDefaultMapping`, `createPostgresTypeMap`, `extractEnumInfo`, `parseRawDefault`, or anything from `@prisma-next/psl-printer/postgres`.
- `inspect-live-schema.ts` is identical for every family.
- `contract-infer.ts` uses a capability check, not a `familyId` string compare.
- `psl-printer` is fully clean of SQL types (the temporary shim from M1, if any, is gone).

## Tasks

Tests are written before the implementation they cover.

### 2.1 Move SQL→AST logic from `psl-printer` into the SQL family

Create `packages/2-sql/9-family/src/core/psl-contract-infer/` (or similar) containing:

- `sqlSchemaIrToPslAst(ir: SqlSchemaIR): PslDocumentAst` — the new entry point. Internally:
    - Resolves native types (logic from `postgres-type-map.ts`).
    - Maps raw defaults (logic from `postgres-default-mapping.ts`, `default-mapping.ts`, `raw-default-parser.ts`).
    - Extracts enum info from SQL annotations (logic that was in `postgres-type-map.ts`'s `extractEnumInfo`).
    - Infers PSL relation fields from foreign keys (logic from `relation-inference.ts`).
    - Builds the `PslDocumentAst` directly: `PslModel`, `PslField`, `PslEnum`, `PslAttribute` nodes with appropriate `span` placeholders (synthetic spans, since this is a generated AST not a parsed one).
- The supporting helpers (`name-transforms.ts`, `mapDefault`, etc. that are still useful) move alongside.

**M1-bridge cleanup as part of 2.1.** M1 added two optional fields to `PslDocumentAst` (`headerComment`) and `PslModel` (`comment`) to support the `printPslLegacy` serialize-parse-reprint round-trip. Once `sqlSchemaIrToPslAst` constructs the AST directly (not via parse), these legacy fields should not be needed by the SQL family's M2 path:

- The introspection "no PK" model warning the SQL family wants on top of the model can be expressed as part of the AST natively (e.g., a synthetic comment node, or just dropped — verify that the existing `validatePrintableSqlSchemaIR` warning text isn't load-bearing for any consumer).
- The default header line override is not needed once the legacy shim is deleted; `printPsl(ast)` can carry its built-in default unmodified.

If M2 confirms these fields are no longer used after the SQL family's direct AST construction takes over, **delete them from `@prisma-next/psl-types`** as part of 2.1's cleanup. If M2 surfaces a reason they're still needed, leave them and update the spec/plan to reflect the new long-term shape.

Add `@prisma-next/psl-types` (or `@prisma-next/psl-parser`, depending on M1's OQ-1 decision) to `packages/2-sql/9-family/package.json` for the AST types.

If M1 took approach (a) (kept a `legacy-shim.ts` in the printer): delete `legacy-shim.ts` and the printer's old `printPsl` overload.

**Tests** (`packages/2-sql/9-family/test/psl-contract-infer/sql-schema-ir-to-psl-ast.test.ts`):
- A SQL schema IR fixture with one table → produces a `PslDocumentAst` with the expected `PslModel`.
- Foreign-key columns produce relation fields with structured `@relation` attributes.
- Enum annotations produce a `PslEnum` declaration and matching field type references.
- A column with a raw `now()` default produces a `@default(now())` attribute.
- The output AST, when fed to `printPsl`, produces the same PSL text as the old `printPsl(schemaIR, options)` did for the same input. (Equivalence test against the M1 baseline.)

### 2.2 Define `PslContractInferCapable` in `framework-components`

In `packages/1-framework/1-core/framework-components/src/control-capabilities.ts`:

```typescript
import type { PslDocumentAst } from '@prisma-next/psl-types'; // or psl-parser

export interface PslContractInferCapable<TSchemaIR = unknown> {
  inferPslContract(schemaIR: TSchemaIR): PslDocumentAst;
}

export function hasPslContractInfer<TFamilyId extends string, TSchemaIR>(
  instance: ControlFamilyInstance<TFamilyId, TSchemaIR>,
): instance is ControlFamilyInstance<TFamilyId, TSchemaIR> & PslContractInferCapable<TSchemaIR> {
  return (
    'inferPslContract' in instance &&
    typeof (instance as Record<string, unknown>)['inferPslContract'] === 'function'
  );
}
```

Export the type and predicate from `src/exports/control.ts`.

**Tests** (`packages/1-framework/1-core/framework-components/test/control-capabilities.test.ts`):
- Mirror the existing `hasSchemaView` tests: predicate true / false / non-function-method.

### 2.3 Implement `PslContractInferCapable` on `SqlControlFamilyInstance`

In `packages/2-sql/9-family/src/core/control-instance.ts`:

- `SqlControlFamilyInstance` now extends `PslContractInferCapable<SqlSchemaIR>`.
- Implementation:
  ```typescript
  inferPslContract(schemaIR: SqlSchemaIR): PslDocumentAst {
    return sqlSchemaIrToPslAst(schemaIR);
  }
  ```

**Tests**:
- `hasPslContractInfer(sqlFamilyInstance)` is `true`.
- `hasPslContractInfer(mongoFamilyInstance)` is `false`. (Cross-family negative test, kept lightweight by mocking.)

### 2.4 Add `inferPslContract` to `ControlClient`

In `packages/1-framework/3-tooling/cli/src/control-api/client.ts` and `control-api/types.ts`:

- Type addition on the `ControlClient` interface:
  ```typescript
  inferPslContract(schemaIR: unknown): PslDocumentAst | undefined;
  ```
- Implementation: ensure `init()`, then check `hasPslContractInfer(this.familyInstance)` and either return the result or `undefined`. Mirrors `toSchemaView`.

**Tests** (`packages/1-framework/3-tooling/cli/test/control-api/client.test.ts`):
- Mock family instance with `inferPslContract` → `client.inferPslContract(...)` delegates and returns the expected AST.
- Mock family instance without it → `client.inferPslContract(...)` returns `undefined`.

### 2.5 Rewrite `contract-infer.ts`

In `packages/1-framework/3-tooling/cli/src/commands/contract-infer.ts`:

- Remove imports: `validatePrintableSqlSchemaIR`, `createPostgresDefaultMapping`, `createPostgresTypeMap`, `extractEnumInfo`, `parseRawDefault`. Keep only `printPsl` from `@prisma-next/psl-printer`.
- Remove the `target.familyId !== 'sql'` guard.
- Replace the body that previously ran `validatePrintableSqlSchemaIR(...)` + `printPsl(schema, options)` with:
  ```typescript
  const ast = client.inferPslContract(inspectResult.value.schema);
  if (!ast) {
    return notOk(errorRuntime('contract infer is not supported for this family', {
      why: 'The configured family does not support inferring a PSL contract from a live schema.',
      fix: 'Use a SQL-family target (e.g. Postgres).',
    }));
  }
  const pslContent = printPsl(ast);
  ```

**Note on client lifecycle**: today `inspectLiveSchema` constructs the client, calls introspect, calls `toSchemaView`, then closes the client in `finally`. The capability call needs the client too — easiest fix: call `client.inferPslContract` *inside* `inspectLiveSchema`'s scope. Two options:
- **(a)** Pass a `consume(client, schemaIR): T` callback to `inspectLiveSchema`. Returned `InspectLiveSchemaResult` includes the consumer's `T`. Default proposal.
- **(b)** Refactor `inspectLiveSchema` to accept a `client` rather than constructing one, letting the caller own lifecycle.

Decision recorded during execution. If (a): the SQL `contract infer` test still passes; the consumer callback constructs the AST and the framework writes the file.

**Tests** (`packages/1-framework/3-tooling/cli/test/commands/contract-infer.test.ts`):
- Mock SQL family with `inferPslContract` → command writes expected PSL to disk.
- Mock Mongo family without `inferPslContract` → command returns a `CliStructuredError` whose envelope `why` does **not** contain the literal string `'family "mongo"'` (asserts capability-based wording).
- Existing test cases for `--output` resolution, overwrite warning, JSON mode pass unchanged.
- A snapshot test: end-to-end SQL `contract infer` produces byte-identical PSL to the M1 baseline (catches regressions in the SQL family's AST construction).

### 2.6 Strip SQL imports from `inspect-live-schema.ts`

In `packages/1-framework/3-tooling/cli/src/commands/inspect-live-schema.ts`:

- Remove `import { validatePrintableSqlSchemaIR } from '@prisma-next/psl-printer'`.
- Remove the `// TODO(TML-2251)` comment and the `familyId === 'sql'` branch.
- Body becomes:
  ```typescript
  const schema = await client.introspect({ connection: dbConnection, onProgress });
  const schemaView = client.toSchemaView(schema);
  ```

**Tests**:
- Existing tests in `cli/test/commands/inspect-live-schema.test.ts` pass without modification.
- New test: a non-SQL family config (`familyId: 'mongo'`) → result `schema` is the unmodified IR; `schemaView` is whatever the mocked `toSchemaView` returned.

### 2.7 Drop `@prisma-next/psl-printer` postgres entrypoint usage from CLI deps

After 2.5 the CLI may still depend on `@prisma-next/psl-printer` for the `printPsl` import — that's fine. Verify it no longer references `@prisma-next/psl-printer/postgres`. Update `package.json` if anything stale remains.

**Tests**:
- `pnpm typecheck` from CLI directory passes.
- `pnpm lint:deps` passes.

### 2.8 M2 checks

- `pnpm test:packages` clean.
- `pnpm lint:deps` clean.
- `rg "@prisma-next/(sql-|psl-printer/postgres)" packages/1-framework/3-tooling/cli/src/commands/inspect-live-schema.ts packages/1-framework/3-tooling/cli/src/commands/contract-infer.ts` returns no matches.
- `rg "familyId\\s*===" packages/1-framework/3-tooling/cli/src/commands/inspect-live-schema.ts packages/1-framework/3-tooling/cli/src/commands/contract-infer.ts` returns no matches.

## Test coverage table

| Behaviour | Test type | Location |
|---|---|---|
| `sqlSchemaIrToPslAst` produces correct AST for fixtures | Unit | `2-sql/9-family/test/psl-contract-infer/...` |
| `sqlSchemaIrToPslAst` + `printPsl` matches M1 baseline output | Snapshot | same |
| `hasPslContractInfer` predicate semantics | Unit | `framework-components/test/control-capabilities.test.ts` |
| SQL family implements the capability | Unit | `2-sql/9-family/test/control-instance-printable.test.ts` |
| `client.inferPslContract` delegates / returns `undefined` | Unit | `cli/test/control-api/client.test.ts` |
| `contract infer` writes PSL via capability | Unit | `cli/test/commands/contract-infer.test.ts` |
| `contract infer` error wording is capability-based for Mongo | Unit | same |
| `contract infer` end-to-end SQL byte-identical to M1 | Snapshot | same |
| `inspect-live-schema` is family-agnostic | Unit | `cli/test/commands/inspect-live-schema.test.ts` |

## Risks and notes

- **Span placeholders in generated AST**: `PslDocumentAst` nodes have `span` fields; the parser fills these from the source text. The SQL family generates the AST from scratch, so spans are synthetic. Default proposal: synthetic span values pointing to offset 0 (length 0). The printer ignores spans during stringification, so this is a no-op for output. Verified during 1.1 fixtures.
- **Equivalence with M1 baseline**: any divergence is a bug in the new SQL→AST construction. The snapshot test in 2.5 catches it. If divergence is acceptable (e.g. cosmetic ordering), accept the new baseline and document the change.
- **Client lifecycle refactor (2.5)**: small but real. If approach (a) (consumer callback) creates awkward types, fall back to (b) (caller owns lifecycle). Either way, `inspectLiveSchema`'s public signature may shift slightly; the calling commands (`db schema`, `contract infer`) get adjusted.
