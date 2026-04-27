import { CliStructuredError } from '@prisma-next/errors/control';

/**
 * A `PostgresMigration` instance method that needs the materialized control
 * adapter (currently only `this.dataTransform(...)`) was invoked, but the
 * migration was constructed without a `ControlStack`. Concrete authoring
 * usage always goes through the migration CLI entrypoint, which assembles
 * a stack from the loaded `prisma-next.config.ts`; reaching this error
 * means a test fixture or ad-hoc consumer instantiated `PostgresMigration`
 * with the no-arg form (legal for `operations` / `describe` introspection
 * only).
 *
 * Distinct from `PN-MIG-2001` (placeholder not filled) and `PN-MIG-2005`
 * (data-transform query plan against wrong contract) because the missing
 * input is the stack itself, not the per-operation contract.
 *
 * Lives in `@prisma-next/target-postgres/errors` rather than the shared
 * framework migration errors module because the failure is target-specific:
 * the contract it talks about (`PostgresMigration`, the Postgres control
 * adapter, the Postgres-target stack) only exists in this package.
 */
export function errorPostgresMigrationStackMissing(): CliStructuredError {
  return new CliStructuredError(
    '2007',
    'PostgresMigration.dataTransform requires a control adapter',
    {
      domain: 'MIG',
      why: 'PostgresMigration.dataTransform was invoked on an instance constructed without a ControlStack. The stored controlAdapter is undefined, so dataTransform cannot lower its query plan.',
      fix: 'Construct the migration via the migration CLI entrypoint (which assembles a ControlStack from the loaded prisma-next.config.ts), or pass a ControlStack containing a Postgres adapter to the migration constructor in test fixtures.',
      meta: {},
    },
  );
}
