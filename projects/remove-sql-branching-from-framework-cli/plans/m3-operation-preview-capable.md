# M3 — `OperationPreviewCapable` and `sql` field rename

**Spec:** [`../spec.md`](../spec.md) (Capability 2, A1, A4, A5)

## Goal

Replace the framework CLI's family-switching `extractOperationStatements` dispatch with a capability-gated `OperationPreviewCapable` interface implemented by each family. Rename the `sql` field on every migration result type to a family-agnostic `preview?: OperationPreview`. Delete the SQL-specific helpers from the framework CLI.

By the end of this milestone:

- The framework CLI does not contain `extractSqlDdl` or `extract-operation-statements.ts`.
- `MigrationCommandResult.plan.sql`, `MigrationShowResult.sql`, `MigrationPlanResult.sql`, `DbInitSuccess.plan.sql`, `DbUpdateSuccess.plan.sql` are all renamed to `preview?: OperationPreview`.
- Mongo migration commands gain a populated preview.
- Formatter output for SQL is byte-identical to before (per OQ-4).

## Tasks

Tests are written before the implementation they cover.

### 3.1 Define the view type and capability in `framework-components`

In `packages/1-framework/1-core/framework-components/src/`:

- New file `control-operation-preview.ts`:
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
- In `control-capabilities.ts`, add:
  ```typescript
  export interface OperationPreviewCapable {
    toOperationPreview(operations: readonly MigrationPlanOperation[]): OperationPreview;
  }
  export function hasOperationPreview<TFamilyId extends string, TSchemaIR>(
    instance: ControlFamilyInstance<TFamilyId, TSchemaIR>,
  ): instance is ControlFamilyInstance<TFamilyId, TSchemaIR> & OperationPreviewCapable {
    return (
      'toOperationPreview' in instance &&
      typeof (instance as Record<string, unknown>)['toOperationPreview'] === 'function'
    );
  }
  ```
- Export from `src/exports/control.ts`: types `OperationPreview`, `OperationPreviewStatement`, `OperationPreviewCapable`; function `hasOperationPreview`.

**Tests** (`framework-components/test/control-capabilities.test.ts`):
- `hasOperationPreview` true / false / non-function-method, mirroring the `hasSchemaView` tests.

### 3.2 Move `extractSqlDdl` into the SQL family and implement `OperationPreviewCapable`

- Copy `packages/1-framework/3-tooling/cli/src/control-api/operations/extract-sql-ddl.ts` into `packages/2-sql/9-family/src/core/operation-preview.ts`. Wrap the result:
  ```typescript
  export function sqlOperationsToPreview(
    operations: readonly MigrationPlanOperation[],
  ): OperationPreview {
    const statements = extractSqlDdl(operations).map(text => ({ text, language: 'sql' as const }));
    return { statements };
  }
  ```
- Update `SqlControlFamilyInstance` to extend `OperationPreviewCapable` and implement `toOperationPreview` by delegating to `sqlOperationsToPreview`.
- Move existing tests from `cli/test/control-api/extract-sql-ddl.test.ts` into the SQL family alongside the moved code, adjusting imports.

**Tests** (in the SQL family test file):
- Existing `extractSqlDdl` test cases pass after the move.
- New: `sqlFamilyInstance.toOperationPreview(ops)` returns `OperationPreview` with `language: 'sql'` on every statement.
- New: `hasOperationPreview(sqlFamilyInstance)` is `true`.

### 3.3 Implement `OperationPreviewCapable` on the Mongo family

- Verify location of `MongoDdlCommandFormatter` (per `projects/mongo-schema-migrations/specs/cli-display.spec.md`). Implement `mongoOperationsToPreview(ops)` next to the Mongo family code (`packages/2-mongo-family/9-family/src/core/operation-preview.ts` or in the Mongo target package, depending on where the formatter lives).
- Add `toOperationPreview` to `MongoFamilyInstance`. Each statement carries `language: 'mongodb-shell'`.

**Tests** (Mongo family test file):
- A `createIndex` command → one statement starting with `db.<collection>.createIndex(`.
- A `dropIndex` command → one statement of the form `db.<collection>.dropIndex("<name>")`.
- An empty operations array → empty `statements`.
- `hasOperationPreview(mongoFamilyInstance)` is `true`.

### 3.4 Add `toOperationPreview` to `ControlClient`

In `packages/1-framework/3-tooling/cli/src/control-api/client.ts` and `control-api/types.ts`:

- Add to the `ControlClient` interface:
  ```typescript
  toOperationPreview(operations: readonly MigrationPlanOperation[]): OperationPreview | undefined;
  ```
- Implementation: `init()`, then `hasOperationPreview(this.familyInstance)` check + delegation. Mirrors `toSchemaView`.

**Tests** (`cli/test/control-api/client.test.ts`):
- Capable family → returns the preview.
- Non-capable family → returns `undefined`.

### 3.5 Rename the result-type field across the CLI

The field `sql?: readonly string[]` becomes `preview?: OperationPreview` in:

- `cli/src/control-api/types.ts`: `DbInitSuccess.plan.sql` → `preview`, `DbUpdateSuccess.plan.sql` → `preview`.
- `cli/src/utils/formatters/migrations.ts`: `MigrationCommandResult.plan.sql` → `preview`, internal `MigrationShowResult.sql` → `preview`.
- `cli/src/commands/migration-show.ts`: `MigrationShowResult.sql` → `preview` (always present, possibly with empty `statements`).
- `cli/src/commands/migration-plan.ts`: `MigrationPlanResult.sql` → `preview`.

In each producer site, replace `extractOperationStatements(...)` / `extractSqlDdl(...)` with `client.toOperationPreview(ops)`. Where the result was `string[] | undefined` and read as `result.sql`, the consumer now reads `result.preview?.statements`.

The framework CLI's `extract-operation-statements.ts` and `extract-sql-ddl.ts` files (and their tests) are **deleted** in this task.

**Tests** (updates):
- `cli/test/utils/formatters/migrations.test.ts`: formatter output for SQL is byte-identical.
- `cli/test/commands/migration-show.test.ts`, `migration-plan.test.ts`, `db-update.test.ts`, `db-init.test.ts`: any test asserting on `.sql` is updated to assert on `.preview.statements[].text`. JSON snapshots are regenerated.
- New: `migration show` against a Mongo migration package returns `preview.statements` with `language: 'mongodb-shell'`.

### 3.6 Update CLI formatters to render the new shape

In `cli/src/utils/formatters/migrations.ts` and `cli/src/commands/migration-plan.ts`:

- The "DDL preview" block reads `preview.statements` instead of `sql`.
- For each statement: render `text`. Append `;` only if `language === 'sql'` and the line doesn't already end with `;` (matches today's behaviour for SQL; doesn't add `;` to Mongo shell lines).

Per OQ-4, the section header stays as today's `DDL preview` (no language suffix).

**Tests**:
- Snapshot test for SQL formatter output (byte-identical baseline).
- Snapshot test for Mongo formatter output (single new fixture).

### 3.7 M3 checks

- `pnpm test:packages` clean across `cli`, `framework-components`, `2-sql/9-family`, `2-mongo-family/9-family`.
- `pnpm lint:deps` clean.
- `rg "extractSqlDdl|extract-sql-ddl|extract-operation-statements" packages/1-framework/3-tooling/cli/src/` returns no matches.
- `rg "familyId\\s*===" packages/1-framework/3-tooling/cli/src/` returns no matches anywhere in the CLI.
- `rg "\\bsql:\\s*readonly" packages/1-framework/3-tooling/cli/src/` returns no matches (no surviving `sql: readonly string[]` field declarations).

## Test coverage table

| Behaviour | Test type | Location |
|---|---|---|
| `hasOperationPreview` predicate | Unit | `framework-components/test/control-capabilities.test.ts` |
| SQL `toOperationPreview` produces `language: 'sql'` and existing DDL | Unit | `2-sql/9-family/test/operation-preview.test.ts` |
| Mongo `toOperationPreview` produces `language: 'mongodb-shell'` for each command kind | Unit | `2-mongo-family/9-family/test/operation-preview.test.ts` (or Mongo target test dir) |
| `client.toOperationPreview` delegates / returns `undefined` | Unit | `cli/test/control-api/client.test.ts` |
| `MigrationCommandResult.preview` rename surfaces in JSON output | Unit + snapshot | `cli/test/commands/db-update.test.ts`, `cli/test/commands/db-init.test.ts` |
| `MigrationShowResult.preview` rename surfaces for SQL and Mongo | Unit | `cli/test/commands/migration-show.test.ts` |
| `MigrationPlanResult.preview` populated from `client.toOperationPreview` | Unit | `cli/test/commands/migration-plan.test.ts` |
| Formatter output for SQL: byte-identical | Snapshot | `cli/test/utils/formatters/migrations.test.ts` |
| Formatter output for Mongo: contains expected `db.X.createIndex(...)` lines | Snapshot | same |

## Risks and notes

- **JSON output rename is a breaking change** for any external script parsing CLI JSON output. Per `AGENTS.md` ("No backward-compat shims; update call sites instead"), this is acceptable. Call out in the PR description.
- **`MongoDdlCommandFormatter` location**: verify during execution. The M4 plan suggests the Mongo target package; if the formatter doesn't yet exist (M4 is incomplete), implementing it is part of this task.
