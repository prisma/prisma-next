/**
 * Shared helper for emitting `ops.json` and attesting `migration.json` for a
 * migration package's `migration.ts`.
 *
 * The target's `emit` capability dynamic-imports `migration.ts`,
 * instantiates the default-exported `Migration` subclass (or invokes the
 * default-exported factory function), reads `operations`, and writes
 * `ops.json`. This helper then attests `migration.json` once the
 * capability returns. Attestation is owned here so the on-disk artifacts
 * are guaranteed to be fully attested when emit returns.
 *
 * Note that this helper is the CLI-driven emit path. Class-flow
 * `migration.ts` files are also self-emitting via `Migration.run(...)`
 * when run directly; that path attests inside `Migration.run` and
 * produces byte-identical artifacts. This helper exists primarily to
 * give `migration plan` a single in-process emit dispatch.
 *
 * Used by `migration emit` (always) and `migration plan` (always, after
 * scaffolding `migration.ts`). Runs in-process so that structured errors
 * thrown during evaluation (notably `errorUnfilledPlaceholder` with code
 * `PN-MIG-2001`) propagate as real exceptions and the CLI's error
 * envelope renders them with full structured metadata.
 */

import type { TargetBoundComponentDescriptor } from '@prisma-next/framework-components/components';
import type {
  MigrationPlanOperation,
  TargetMigrationsCapability,
} from '@prisma-next/framework-components/control';
import { attestMigration } from '@prisma-next/migration-tools/attestation';
import { hasMigrationTs } from '@prisma-next/migration-tools/migration-ts';
import { errorMigrationFileMissing, errorTargetMigrationNotSupported } from '../utils/cli-errors';

/**
 * Context passed to `emitMigration`. Captures everything the helper needs to
 * dispatch without re-loading the config.
 */
export interface EmitMigrationContext {
  readonly targetId: string;
  readonly migrations: TargetMigrationsCapability;
  readonly frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<string, string>>;
}

/**
 * Result of a successful emit: the operations that were written to `ops.json`
 * (display-oriented shape) and the content-addressed migrationId persisted to
 * `migration.json`.
 */
export interface EmitMigrationResult {
  readonly operations: readonly MigrationPlanOperation[];
  readonly migrationId: string;
}

/**
 * Emit `ops.json` and attest `migrationId` for the migration package at `dir`.
 *
 * Delegates to the target's `emit` capability. Throws a structured error if
 * `migration.ts` is missing or the target does not implement `emit`. Other
 * structured errors thrown during evaluation propagate unchanged.
 */
export async function emitMigration(
  dir: string,
  ctx: EmitMigrationContext,
): Promise<EmitMigrationResult> {
  if (!(await hasMigrationTs(dir))) {
    throw errorMigrationFileMissing(dir);
  }

  if (!ctx.migrations.emit) {
    throw errorTargetMigrationNotSupported({
      why: `Target "${ctx.targetId}" does not implement the \`emit\` migrations capability; cannot emit a migration package`,
    });
  }

  const operations = await ctx.migrations.emit({
    dir,
    frameworkComponents: ctx.frameworkComponents,
  });
  const migrationId = await attestMigration(dir);
  return { operations, migrationId };
}
