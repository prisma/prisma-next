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
 * A scaffolded migration contains a placeholder slot that was never filled in.
 *
 * Thrown at emit time (when `check.source()` or `run()` is invoked) via the
 * `placeholder(...)` utility. The `slot` identifies the exact location the
 * author still needs to edit, e.g. `"backfill-product-status:check.source"`.
 */
export function errorUnfilledPlaceholder(slot: string): CliStructuredError {
  return new CliStructuredError('2001', 'Unfilled migration placeholder', {
    domain: 'MIG',
    why: `The migration contains a placeholder that has not been filled in: ${slot}`,
    fix: 'Open migration.ts and replace the `placeholder(...)` call with your actual query.',
    meta: { slot },
  });
}

/**
 * Scaffolded `migration.ts` files call this wherever the scaffolder couldn't
 * emit a real query and the author is expected to fill one in. Always throws
 * a structured migration error (`PN-MIG-2001`).
 *
 * The return type `never` makes it assignable to any expected return type, so
 * a scaffolded `() => placeholder('...')` satisfies signatures like
 * `() => MongoQueryPlan` without polluting them with a sentinel union arm.
 */
export function placeholder(slot: string): never {
  throw errorUnfilledPlaceholder(slot);
}

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
 * factory function returning a `MigrationPlan`-shaped object (with at least
 * an `operations` array, plus `targetId` and `destination`). Thrown when the
 * default export is missing, is not a constructor/function, does not extend
 * `Migration`, or (for factory functions) returns a value that is not
 * `MigrationPlan`-shaped.
 */
export function errorMigrationInvalidDefaultExport(
  dir: string,
  actualExportDescription?: string,
): CliStructuredError {
  return new CliStructuredError('2003', 'migration.ts default export is not a valid migration', {
    domain: 'MIG',
    why:
      actualExportDescription !== undefined
        ? `migration.ts at "${dir}" must default-export a Migration subclass or a factory function returning a MigrationPlan-shaped object; got ${actualExportDescription}`
        : `migration.ts at "${dir}" must default-export a Migration subclass or a factory function returning a MigrationPlan-shaped object.`,
    fix: 'Use `export default class extends Migration { ... }` or `export default () => ({ targetId, destination, operations })`.',
    meta: {
      dir,
      ...(actualExportDescription !== undefined ? { actualExport: actualExportDescription } : {}),
    },
  });
}

/**
 * A class-flow `Migration.operations` getter returned a value that is not an
 * array. Used by class-flow emit capabilities after instantiating the
 * authored migration.
 */
export function errorMigrationPlanNotArray(
  dir: string,
  actualValueDescription?: string,
): CliStructuredError {
  return new CliStructuredError('2004', 'Migration.operations must be an array of operations', {
    domain: 'MIG',
    why:
      actualValueDescription !== undefined
        ? `Migration.operations for migration.ts at "${dir}" was ${actualValueDescription}; an array of operations is required.`
        : `Migration.operations for migration.ts at "${dir}" is not an array of operations.`,
    fix: 'Ensure your `operations` getter returns an array of operations; see the data-migrations authoring guide.',
    meta: {
      dir,
      ...(actualValueDescription !== undefined ? { actualValue: actualValueDescription } : {}),
    },
  });
}

/**
 * A target's migrations capability registers neither `resolveDescriptors`
 * (descriptor flow) nor `emit` (class flow). Surfaced by the strategy
 * selector when it is unable to choose a flow for the target. This is an
 * internal wiring error: every migration-supporting target must implement
 * exactly one of the two flows.
 */
export function errorTargetHasIncompleteMigrationCapabilities(options: {
  readonly targetId: string;
}): CliStructuredError {
  return new CliStructuredError('2011', 'Target migrations capability is incomplete', {
    domain: 'MIG',
    why: `Target "${options.targetId}" registers a migrations capability but implements neither \`resolveDescriptors\` (descriptor flow) nor \`emit\` (class flow); the CLI cannot choose an authoring strategy.`,
    fix: 'This is an internal wiring error. Report it — the target descriptor must implement exactly one of the two migration flows.',
    meta: { targetId: options.targetId },
  });
}

/**
 * A migration plan was asked to render itself back to TypeScript but the
 * target does not support authoring-surface rendering. Thrown by Postgres's
 * descriptor-flow plan when `renderTypeScript()` is invoked (the CLI only
 * calls it in the class-flow branch of `migration plan`, so this acts as a
 * safety rail rather than a user-visible error in normal use).
 */
export function errorPlanDoesNotSupportAuthoringSurface(options: {
  readonly targetId: string;
}): CliStructuredError {
  return new CliStructuredError(
    '2010',
    'Migration plan does not support TypeScript authoring surface',
    {
      domain: 'MIG',
      why: `Target "${options.targetId}" produced a descriptor-flow plan; descriptor-flow plans cannot be rendered back to TypeScript via renderTypeScript().`,
      fix: 'This is an internal wiring error. Report it — the CLI should route descriptor-flow targets through renderDescriptorTypeScript, not renderTypeScript.',
      meta: { targetId: options.targetId },
    },
  );
}
