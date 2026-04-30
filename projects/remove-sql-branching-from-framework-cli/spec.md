# Remove SQL-specific branching from framework CLI commands

**Linear:** [TML-2251](https://linear.app/prisma-company/issue/TML-2251/remove-sql-specific-branching-from-framework-cli-commands-inspect-live)

## Context

The framework CLI lives in `packages/1-framework/3-tooling/cli/` and is meant to be **family-agnostic**: it reads config, talks to a `ControlClient` via interfaces declared in `@prisma-next/framework-components`, and never branches on `familyId`. Concrete family logic (SQL, Mongo) lives in their respective family packages and is reached only through capability interfaces.

Three places currently violate that boundary:

1. **`inspect-live-schema.ts`** branches on `config.family.familyId === 'sql'` to call `validatePrintableSqlSchemaIR(schemaIR)` from `@prisma-next/psl-printer`. The result type is widened to `unknown` and passed downstream.
2. **`contract-infer.ts`** consumes that opaque schema, re-runs `validatePrintableSqlSchemaIR` on it, then calls `printPsl(schema, { defaultMapping, typeMap, enumInfo, parseRawDefault })` with Postgres-specific helpers from `@prisma-next/psl-printer/postgres`. It also gates on `target.familyId !== 'sql'` to refuse non-SQL families.
3. **Migration result types** (`MigrationCommandResult`, `MigrationShowResult`, `MigrationPlanResult`, `DbInitSuccess`, `DbUpdateSuccess`) carry a `sql?: readonly string[]` field. The dispatch in `extract-operation-statements.ts` switches on `familyId` and only handles SQL today; `migration-plan.ts` calls `extractSqlDdl` directly (silently producing no preview for non-SQL families).

This was introduced as a pragmatic interim step when MongoDB support landed (TML-2233, M4 plan task 4.20). The framework needs to stop importing or referencing family-specific types entirely. The existing `SchemaViewCapable` / `hasSchemaView` capability pattern in `framework-components/src/control-capabilities.ts` shows how.

There is also a pre-existing **layering oddity**: `@prisma-next/psl-printer` is in framework-domain (`packages/1-framework/2-authoring/psl-printer/`) but imports `@prisma-next/sql-schema-ir/types` and exports a SQL-flavoured input shape (`PslPrintableSqlSchemaIR`). Cleanly decoupling `inspect-live-schema.ts` and `contract-infer.ts` from SQL-specific types requires fixing this oddity, because the printer is the type-bridge that re-introduces SQL types into framework code. Fixing it is in scope here, because doing so is the lowest-friction way to give the framework a non-SQL `printPsl(...)` to call.

## Goal

Replace every family-specific branch and import in the framework CLI with **capability-gated views**, so that the framework only ever sees opaque IRs and family-agnostic, dialect-free types. As a precondition, narrow `@prisma-next/psl-printer`'s public surface so its input is the existing PSL parser AST (`PslDocumentAst`) — not a SQL-shaped intermediate. Keep the parser and the printer symmetric: `string ⇄ PslDocumentAst`.

## Pattern: capability-gated views

The framework already has one example of this pattern (`SchemaViewCapable`):

- A **view type** lives in `@prisma-next/framework-components` (e.g. `CoreSchemaView`) or in another framework-domain package whose contract is the view (e.g. `psl-parser`'s `PslDocumentAst`). It is family-agnostic.
- A **capability interface** declares a method that produces the view from the family's opaque IR (e.g. `SchemaViewCapable.toSchemaView(schemaIR): CoreSchemaView`).
- A **type predicate** lets the framework detect whether a family instance implements the capability (e.g. `hasSchemaView(instance)`).
- The **`ControlClient` exposes a delegation method** that runs the predicate and returns the view, or `undefined` (e.g. `client.toSchemaView(schemaIR): CoreSchemaView | undefined`).
- **Commands gate on the capability**: if the view is required and absent, return a structured error explaining which family is needed (the error refers to the missing capability, not a `familyId` string).

Two new capabilities are introduced in this project: `PslContractInferCapable` and `OperationPreviewCapable`.

## PSL parser/printer symmetry

The parser already produces a complete PSL AST: `PslDocumentAst` (in `@prisma-next/psl-parser`), with structured `PslModel` / `PslField` / `PslEnum` / `PslAttribute` / `PslNamedTypeDeclaration` nodes that carry everything needed to reconstruct a `.prisma` file. The printer's existing internal types (`PrinterModel`, `PrinterField`, etc.) are a lossy reduction of this AST tailored for stringification — they're an internal optimisation, not a separate contract. Verified by inspection: every printer-specific field (`isId`, `isRelation`, `isUnsupported`, `mapName`, `comment`) is derivable from `PslDocumentAst`'s structured attributes; nothing in `PrinterModel` carries information that `PslDocumentAst` doesn't already.

Therefore: **the printer's public input is `PslDocumentAst`**. The existing `print-psl.ts` splits cleanly along the line in the source where it transitions from "transform `PslPrintableSqlSchemaIR` + options → `PrinterModel[]`" (lines 86-~700) to "stringify `PrinterModel[]`" (lines ~770+). The transformation half is repurposed as `PslDocumentAst → PrinterModel[]` (a pure, dialect-free reduction); the stringification half stays. The SQL-flavoured input types and the Postgres helpers are removed from the printer's public surface; SQL → `PslDocumentAst` construction moves into the SQL family.

## Non-goals

- **Generalising `printPsl` formatting options** (header text, indentation, spacing). The current single-formatting behaviour is preserved. The framework CLI gains responsibility for "calling `printPsl` and writing the result", but not for parameterising it.
- **Generalising the inference pipeline to non-Postgres SQL targets.** The SQL family's `inferPslContract` implementation continues to assume Postgres conventions (the codebase is Postgres-only in practice today). A `TODO(future)` notes that when other SQL dialects appear, the SQL family will need to dispatch on `target.targetId`.
- **Removing the framework CLI's other SQL-specific dependencies** (`@prisma-next/sql-contract`, `@prisma-next/sql-contract-emitter`, `@prisma-next/sql-contract-ts`). These are used elsewhere (e.g. `db init` template scaffolding) and are out of scope.
- **Adding round-trip support `parser → printer → parser`.** This becomes possible as a side-effect of the printer accepting `PslDocumentAst`, but exhaustively verifying it is a separate concern. A single basic round-trip test is acceptable as a smoke check; full round-trip parity is not in scope.

## Acceptance criteria

A1. **No `familyId === 'sql'` (or any other `familyId === '...'`) string compare appears in any file under `packages/1-framework/3-tooling/cli/src/`.**

A2. **`packages/1-framework/3-tooling/cli/src/commands/inspect-live-schema.ts` does not import from any `@prisma-next/sql-*`, `@prisma-next/psl-printer/postgres`, or other SQL-domain or Postgres-flavoured package.** The body of `inspectLiveSchema` is identical for every family: introspect → optionally produce `CoreSchemaView` → return.

A3. **`packages/1-framework/3-tooling/cli/src/commands/contract-infer.ts` does not import `validatePrintableSqlSchemaIR`, `PslPrintableSqlSchemaIR`, `createPostgresDefaultMapping`, `createPostgresTypeMap`, `extractEnumInfo`, or `parseRawDefault`.** It imports only `printPsl` from `@prisma-next/psl-printer` and `PslDocumentAst` from `@prisma-next/psl-parser` (or the type re-exported via the framework's `ControlClient` surface). The "this family doesn't support contract infer" check is a capability check, not a `familyId` string compare.

A4. **The framework CLI does not import `extractSqlDdl` or any other SQL DDL helper.** Operation-statement preview happens via a capability method on the `ControlClient`; both SQL and Mongo families implement it. `migration-plan.ts`, `migration-show.ts`, `db-init.ts`, `db-update.ts` all use the same family-agnostic call site.

A5. **`MigrationCommandResult.plan.sql`, `MigrationShowResult.sql`, `MigrationPlanResult.sql`, `DbInitSuccess.plan.sql`, `DbUpdateSuccess.plan.sql` are renamed to `preview?: OperationPreview`** (where `OperationPreview = { statements: { text: string; language: string }[] }`, with `language` identifying the dialect — `'sql'`, `'mongodb-shell'`, etc.). The rename is reflected in formatters, JSON snapshots, and tests.

A6. **`@prisma-next/psl-printer`'s public surface accepts `PslDocumentAst` as the printer input.** Specifically: `printPsl(ast: PslDocumentAst): string`. The old `printPsl(schema, options)` signature is removed. `validatePrintableSqlSchemaIR`, `PslPrintableSqlSchemaIR`, `PslPrintableSqlColumn`, `PslPrintableSqlTable`, the Postgres helpers, and `parseRawDefault` are no longer exported from `@prisma-next/psl-printer` or `@prisma-next/psl-printer/postgres` — they are deleted, or moved into the SQL family.

A7. **`@prisma-next/psl-printer` does not import from `@prisma-next/sql-schema-ir/*`** (the pre-existing layering oddity is fixed).

A8. **`pnpm lint:deps` passes.**

A9. **All existing CLI test suites pass.** SQL `db schema`, `db update`, `db init`, `migration plan`, `migration show`, `migration apply`, `contract infer` continue to behave identically. SQL `contract infer` produces byte-identical PSL output to before (snapshot-tested). Mongo `db schema` continues to behave identically and additionally gains a populated operation preview in `db update` / `migration plan` / `migration show`.

A10. **A new behaviour is observable on the Mongo path**: running `prisma-next contract infer` against a Mongo target returns a structured CLI error whose `why` references the missing capability, not the `familyId` string.

## Approach

Three new framework-level pieces are introduced (capability-gated, mirroring `SchemaViewCapable`):

### Capability 1: `PslContractInferCapable`

The family declares it can infer a PSL contract from its schema IR.

**Capability + predicate** (in `packages/1-framework/1-core/framework-components/src/control-capabilities.ts`, alongside `SchemaViewCapable`):

```typescript
import type { PslDocumentAst } from '@prisma-next/psl-parser';

export interface PslContractInferCapable<TSchemaIR = unknown> {
  inferPslContract(schemaIR: TSchemaIR): PslDocumentAst;
}

export function hasPslContractInfer<TFamilyId extends string, TSchemaIR>(
  instance: ControlFamilyInstance<TFamilyId, TSchemaIR>,
): instance is ControlFamilyInstance<TFamilyId, TSchemaIR> & PslContractInferCapable<TSchemaIR>;
```

`framework-components` will need to add `@prisma-next/psl-parser` as a dependency (both are framework-domain, framework-layer-or-below; no layering issue — see Layering check below).

**Client delegation** (on `ControlClient`):

```typescript
inferPslContract(schemaIR: unknown): PslDocumentAst | undefined;
```

Mirrors `client.toSchemaView`.

### Capability 2: `OperationPreviewCapable`

The family declares it can produce a textual preview of migration operations.

**View type** (in `packages/1-framework/1-core/framework-components/src/control-operation-preview.ts`, new file):

```typescript
export interface OperationPreviewStatement {
  readonly text: string;
  /** Dialect identifier, e.g. 'sql', 'mongodb-shell'. */
  readonly language: string;
}

export interface OperationPreview {
  readonly statements: readonly OperationPreviewStatement[];
}
```

**Capability + predicate**:

```typescript
export interface OperationPreviewCapable {
  toOperationPreview(operations: readonly MigrationPlanOperation[]): OperationPreview;
}

export function hasOperationPreview<TFamilyId extends string, TSchemaIR>(
  instance: ControlFamilyInstance<TFamilyId, TSchemaIR>,
): instance is ControlFamilyInstance<TFamilyId, TSchemaIR> & OperationPreviewCapable;
```

**Client delegation**:

```typescript
toOperationPreview(operations: readonly MigrationPlanOperation[]): OperationPreview | undefined;
```

### Printer rework: `printPsl(ast: PslDocumentAst): string`

`packages/1-framework/2-authoring/psl-printer/`:

- **Public surface narrows**:
    - Add `printPsl(ast: PslDocumentAst): string`.
    - Remove `printPsl(schema, options)`, `validatePrintableSqlSchemaIR`, `PslPrintableSqlSchemaIR`, `PslPrintableSqlColumn`, `PslPrintableSqlTable`, `EnumInfo`, `PslPrinterOptions`, `PslTypeMap`, `PslTypeResolution`, `PslNativeTypeAttribute`.
    - Remove the `./postgres` entry-point: `createPostgresDefaultMapping`, `createPostgresTypeMap`, `parseRawDefault` are removed (some helpers — generic `mapDefault`, name transforms — stay as internals).
- **Internal restructuring**:
    - Split `print-psl.ts` along the existing line where it transitions from "transform input → `PrinterModel[]`" (lines 86–~700) to "stringify `PrinterModel[]`" (lines ~770+).
    - The transformation half is rewritten to consume `PslDocumentAst` and produce the same internal `PrinterModel[]` (the existing intermediate stays package-private).
    - The stringification half is unchanged.
    - `relation-inference.ts` and `schema-validation.ts` are deleted (or moved to the SQL family) — they consume SQL-shaped input and have no place in the new printer.
- **`@prisma-next/sql-schema-ir` is removed from `package.json`** (closes A7).

The Postgres-specific helpers (`createPostgresDefaultMapping`, `createPostgresTypeMap`, `parseRawDefault`, `extractEnumInfo`) are deleted from the printer; their *behaviour* migrates into the SQL family's `inferPslContract` implementation, which is responsible for producing the `PslDocumentAst` directly. Relation inference (`relation-inference.ts`) similarly migrates into the SQL family — it's translating SQL foreign keys into PSL relation fields, which is family-specific work.

### SQL family: implement `PslContractInferCapable`

The SQL family gains a `sqlSchemaIrToPslAst(ir: SqlSchemaIR): PslDocumentAst` helper that takes the SQL family's schema IR and produces a `PslDocumentAst`. Internally this helper:
- Maps native types via the (now-internalised) Postgres type map.
- Maps raw defaults via the (now-internalised) Postgres default mapping and raw-default parser.
- Extracts enum info from SQL annotations and emits `PslEnum` declarations + `PslField.typeName` references.
- Infers PSL relation fields from SQL foreign keys (using the migrated relation-inference logic).
- Produces structured `PslAttribute` nodes (rather than today's pre-rendered strings) so the printer can canonicalise their formatting.

`SqlControlFamilyInstance` extends `PslContractInferCapable<SqlSchemaIR>` and implements `inferPslContract` by calling `sqlSchemaIrToPslAst`. **Mongo family does not implement this capability.**

### SQL family: implement `OperationPreviewCapable`

The contents of `cli/src/control-api/operations/extract-sql-ddl.ts` move into the SQL family (e.g. `packages/2-sql/9-family/src/core/operation-preview.ts`). Each statement is wrapped as `{ text, language: 'sql' }`. `SqlControlFamilyInstance` extends `OperationPreviewCapable`. The CLI files `extract-sql-ddl.ts` and `extract-operation-statements.ts` are deleted.

### Mongo family: implement `OperationPreviewCapable`

Following `projects/mongo-schema-migrations/specs/cli-display.spec.md`, the Mongo family uses `MongoDdlCommandFormatter` (or its equivalent — verify location during implementation) to produce statements with `language: 'mongodb-shell'`.

### Framework CLI updates

- **`inspect-live-schema.ts`**: drop the `validatePrintableSqlSchemaIR` import and the `familyId === 'sql'` branch. Body becomes the same one-liner Mongo already runs (`schema = await client.introspect(...); schemaView = client.toSchemaView(schema)`).
- **`contract-infer.ts`**: drop the SQL imports and the `target.familyId !== 'sql'` guard. Use the capability:
  ```typescript
  const ast = client.inferPslContract(inspectResult.value.schema);
  if (!ast) {
    return notOk(errorRuntime('contract infer is not supported for this family', {
      why: 'The configured family does not support inferring a PSL contract from a live schema.',
      fix: 'Use a SQL-family target (e.g. Postgres).',
    }));
  }
  const pslText = printPsl(ast);
  // write pslText to disk, build success result.
  ```
- **Migration commands** (`migration-plan.ts`, `migration-show.ts`, `db-init.ts`, `db-update.ts`): replace `extractSqlDdl(...)` / `extractOperationStatements(...)` with `client.toOperationPreview(ops)`. Read `result.preview?.statements` instead of `result.sql`.
- **Formatters** (`utils/formatters/migrations.ts`, `commands/migration-plan.ts`'s inline formatter): render `preview.statements[].text`. SQL output is byte-identical (statements rendered one per line with `;` suffix when `language === 'sql'`). Mongo output renders `language: 'mongodb-shell'` statements verbatim, no `;` suffix.

### Layering check

- `framework-components` (framework / core / shared) gains a dep on `@prisma-next/psl-parser` (framework / authoring / migration). That's framework→framework, allowed. **Caveat**: layer order for the framework domain is `foundation → core → authoring → tooling`, so a core package importing from authoring is **upward** and forbidden by the `upward: deny` rule. This needs verification during implementation. If it's a violation, the alternatives are:
    - Move `PslDocumentAst` (or just its type definitions) into a core-layer package — e.g. into `framework-components` itself, or a small new `@prisma-next/psl-types` package at framework/core. Parser and printer would both consume it.
    - Define the capability return type as `unknown` at the framework-components layer and tighten it via the family's TSchemaIR generic.
  Default proposal: **add a small `@prisma-next/psl-types` foundation package** that exports the `PslDocumentAst` and friends; parser and printer both consume it, framework-components consumes it. This is the cleanest option and aligns with the parser/printer symmetry.
- `@prisma-next/psl-printer` (framework / authoring) drops its dep on `@prisma-next/sql-schema-ir` (sql / core); replaces it with a dep on `@prisma-next/psl-types` (or imports the AST inline if option (a) above is taken).
- The SQL family (sql / family) gains a dep on `@prisma-next/psl-printer` and `@prisma-next/psl-types`; both are framework, allowed by `sql.mayImportFrom: ['framework']`.
- The framework CLI (framework / tooling / migration) keeps its dep on `@prisma-next/psl-printer`; gains a dep on `@prisma-next/psl-types` (for the `PslDocumentAst` type used in capability return values flowing through `ControlClient`).

## Slicing — three milestones in one PR

This work is delivered as a single PR with three review-friendly milestones (commits or commit groups). They are sequenced because each milestone unblocks the next; reviewing them in order is straightforward.

### Milestone 1 — Printer accepts `PslDocumentAst`

Plan: [`plans/m1-printer-accepts-psl-ast.md`](plans/m1-printer-accepts-psl-ast.md)

Rework `@prisma-next/psl-printer` so its input is `PslDocumentAst`. Resolve the `framework-components` ↔ `psl-parser` layering question (likely by introducing `@prisma-next/psl-types`). At the end of this milestone:

- `printPsl(ast: PslDocumentAst): string` exists and is correct for hand-built fixture ASTs.
- The old `printPsl(schema, options)` is removed; SQL types and Postgres helpers no longer ship from this package.
- `psl-printer` does not import `sql-schema-ir`. (A7)
- `contract infer` is **temporarily broken** at the end of M1 — its old call site is incompatible with the new printer signature. M2 fixes it. (Alternatively, a tiny in-file shim is left during M1 and removed in M2; the shim is short-lived and explicit.)

### Milestone 2 — `PslContractInferCapable` and `contract infer` cleanup

Plan: [`plans/m2-psl-contract-infer-capable.md`](plans/m2-psl-contract-infer-capable.md)

- Introduce `PslContractInferCapable` (capability, predicate, client delegation).
- Move SQL→AST construction logic (Postgres helpers, relation inference, enum extraction, default parsing) from `psl-printer` into the SQL family.
- `SqlControlFamilyInstance` implements `PslContractInferCapable`.
- `contract-infer.ts` rewritten to use the capability + `printPsl(ast)`.
- `inspect-live-schema.ts` strips the SQL branch.
- (A1, A2, A3, A6 fully achieved.)

### Milestone 3 — `OperationPreviewCapable` and `sql` field rename

Plan: [`plans/m3-operation-preview-capable.md`](plans/m3-operation-preview-capable.md)

- Introduce `OperationPreview`, `OperationPreviewCapable`, `hasOperationPreview`, `client.toOperationPreview`.
- SQL family + Mongo family implement the capability.
- Rename `sql` → `preview` across `MigrationCommandResult`, `MigrationShowResult`, `MigrationPlanResult`, `DbInitSuccess`, `DbUpdateSuccess`.
- Delete `extract-sql-ddl.ts`, `extract-operation-statements.ts`.
- Update formatters and tests.
- (A4, A5 achieved.)

### Close-out

Plan: [`plans/close-out.md`](plans/close-out.md)

- Run all acceptance checks.
- Update durable docs (subsystem doc / CLI README) if needed.
- Strip references to this project directory.
- Delete `projects/remove-sql-branching-from-framework-cli/`.

## Open questions (defaults applied if not raised before implementation begins)

- **OQ-1 — `PslDocumentAst` package home.** Default: introduce a small `@prisma-next/psl-types` package at framework/foundation/shared that exports `PslDocumentAst` and friends; parser, printer, framework-components, and the SQL family all consume it. Confirmed during implementation by attempting the simpler "framework-components depends on psl-parser" path first; if `pnpm lint:deps` flags it as upward (core → authoring), fall back to the foundation-package approach.
- **OQ-2 — `inferPslContract` input.** Default: takes `schemaIR: unknown` (the family's opaque `TSchemaIR`) — symmetric with `toSchemaView`. The SQL family casts internally via its known `SqlSchemaIR` shape.
- **OQ-3 — `OperationPreview.language` values.** Default: free-form strings (`'sql'`, `'mongodb-shell'`). Not an enum, since families may invent new ones.
- **OQ-4 — Formatter output for SQL.** Default: byte-identical to today (no `language` suffix in the "DDL preview" header). Add a header suffix only if the user specifically requests it later.

## References

- Linear: [TML-2251](https://linear.app/prisma-company/issue/TML-2251)
- Predecessor M4 plan: `projects/mongo-schema-migrations/plans/m4-online-cli-commands-plan.md` (task 4.20)
- M4 design notes: `projects/mongo-schema-migrations/specs/cli-display.spec.md`
- Existing capability example: `packages/1-framework/1-core/framework-components/src/control-capabilities.ts` (`SchemaViewCapable` / `hasSchemaView`)
- Existing PSL AST: `packages/1-framework/2-authoring/psl-parser/src/types.ts` (`PslDocumentAst`)
