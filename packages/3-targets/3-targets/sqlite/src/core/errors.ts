import { CliStructuredError } from '@prisma-next/errors/control';

/**
 * A `SqliteMigration` operation that needs the materialized control adapter
 * — named by `operation` (e.g. `createTable`, `dropColumn`, `recreateTable`) —
 * was invoked, but the migration was constructed without a `ControlStack`.
 * Concrete authoring usage always goes through the migration CLI entrypoint,
 * which assembles a stack from the loaded `prisma-next.config.ts`; reaching this
 * error means a test fixture or ad-hoc consumer instantiated `SqliteMigration`
 * with the no-arg form (legal for `operations` / `describe` introspection only).
 *
 * The `operation` argument is required so every throw site names the operation
 * that actually failed; a new operation cannot inherit a misattributed message.
 *
 * Distinct from `MIGRATION.UNFILLED_PLACEHOLDER` (placeholder not filled)
 * because the missing input is the stack itself, not the per-operation
 * contract.
 *
 * Lives in `@prisma-next/target-sqlite/errors` rather than the shared
 * framework migration errors module because the failure is target-specific:
 * the contract it talks about (`SqliteMigration`, the SQLite control
 * adapter, the SQLite-target stack) only exists in this package.
 */
export function errorSqliteMigrationStackMissing(operation: string): CliStructuredError {
  return new CliStructuredError(
    'MIGRATION.SQLITE_CONTROL_STACK_MISSING',
    `SqliteMigration.${operation} requires a control adapter`,
    {
      why: `SqliteMigration.${operation} was invoked on an instance constructed without a ControlStack, so the stored controlAdapter is undefined and the operation cannot lower its DDL node.`,
      fix: 'Construct the migration via the migration CLI entrypoint (which assembles a ControlStack from the loaded prisma-next.config.ts), or pass a ControlStack containing a SQLite adapter to the migration constructor in test fixtures.',
      meta: { operation },
    },
  );
}
