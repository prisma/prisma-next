import { CliStructuredError } from './control';

// ============================================================================
// Migration Errors (PN-MIG-2000-2999)
//
// Errors raised by the migration subsystem (authoring, planning, emit).
// Domain `MIG` distinguishes these from generic application runtime errors
// (`RUN`) and from CLI argument/config errors (`CLI`). See
// `docs/CLI Style Guide.md` for the canonical domain taxonomy.
// ============================================================================

/**
 * `migration.ts` was expected at the given package directory but could not be
 * located. Thrown by `emitMigration` (and, as a belt-and-suspenders, by
 * class-flow `emit` capabilities) when the file is missing.
 */
export function errorMigrationFileMissing(dir: string): CliStructuredError {
  return new CliStructuredError('2002', 'migration.ts not found', {
    domain: 'MIG',
    why: `No migration.ts file was found at "${dir}"`,
    fix: 'Scaffold one with `prisma-next migration new` or `prisma-next migration plan`.',
    meta: { dir },
  });
}

/**
 * The `migration.ts` at the given package directory does not default-export a
 * valid migration shape. Two shapes are accepted: a `Migration` subclass, or a
 * factory function returning an object with a `plan()` method. Thrown when the
 * default export is missing, is not a constructor/function, does not extend
 * `Migration`, or (for factory functions) returns a value without `plan()`.
 */
export function errorMigrationInvalidDefaultExport(
  dir: string,
  actualExportDescription?: string,
): CliStructuredError {
  return new CliStructuredError('2003', 'migration.ts default export is not a valid migration', {
    domain: 'MIG',
    why:
      actualExportDescription !== undefined
        ? `migration.ts at "${dir}" must default-export a Migration subclass or a factory function returning { plan() }; got ${actualExportDescription}`
        : `migration.ts at "${dir}" must default-export a Migration subclass or a factory function returning { plan() }.`,
    fix: 'Use `export default class extends Migration { ... }` or `export default () => ({ plan() { return [...] } })`.',
    meta: {
      dir,
      ...(actualExportDescription !== undefined ? { actualExport: actualExportDescription } : {}),
    },
  });
}

/**
 * A class-flow `Migration.plan()` returned a value that is not an array. Used
 * by class-flow emit capabilities after instantiating the authored migration.
 */
export function errorMigrationPlanNotArray(
  dir: string,
  actualValueDescription?: string,
): CliStructuredError {
  return new CliStructuredError('2004', 'Migration.plan() must return an array of operations', {
    domain: 'MIG',
    why:
      actualValueDescription !== undefined
        ? `Migration.plan() for migration.ts at "${dir}" returned ${actualValueDescription}; an array of operations is required.`
        : `Migration.plan() for migration.ts at "${dir}" did not return an array of operations.`,
    fix: 'Ensure your `plan()` method returns an array of operations; see the data-migrations authoring guide.',
    meta: {
      dir,
      ...(actualValueDescription !== undefined ? { actualValue: actualValueDescription } : {}),
    },
  });
}
