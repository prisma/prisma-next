import { CliStructuredError } from '@prisma-next/errors/control';

/**
 * A `PostgresMigration` operation that needs the materialized control adapter
 * — named by `operation` (e.g. `createTable`, `dropColumn`, `dataTransform`) —
 * was invoked, but the migration was constructed without a `ControlStack`.
 * Concrete authoring usage always goes through the migration CLI entrypoint,
 * which assembles a stack from the loaded `prisma-next.config.ts`; reaching this
 * error means a test fixture or ad-hoc consumer instantiated `PostgresMigration`
 * with the no-arg form (legal for `operations` / `describe` introspection only).
 *
 * The `operation` argument is required so every throw site names the operation
 * that actually failed; a new operation cannot inherit a misattributed message.
 *
 * Distinct from `MIGRATION.UNFILLED_PLACEHOLDER` (placeholder not filled)
 * and `MIGRATION.DATA_TRANSFORM_CONTRACT_MISMATCH` (data-transform query
 * plan against wrong contract) because the missing input is the stack
 * itself, not the per-operation contract.
 *
 * Lives in `@prisma-next/target-postgres/errors` rather than the shared
 * framework migration errors module because the failure is target-specific:
 * the contract it talks about (`PostgresMigration`, the Postgres control
 * adapter, the Postgres-target stack) only exists in this package.
 */
export function errorPostgresMigrationStackMissing(operation: string): CliStructuredError {
  return new CliStructuredError(
    'MIGRATION.POSTGRES_CONTROL_STACK_MISSING',
    `PostgresMigration.${operation} requires a control adapter`,
    {
      why: `PostgresMigration.${operation} was invoked on an instance constructed without a ControlStack, so the stored controlAdapter is undefined and the operation cannot lower its plan.`,
      fix: 'Construct the migration via the migration CLI entrypoint (which assembles a ControlStack from the loaded prisma-next.config.ts), or pass a ControlStack containing a Postgres adapter to the migration constructor in test fixtures.',
      meta: { operation },
    },
  );
}
