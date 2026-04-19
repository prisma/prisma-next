/**
 * Mongo's in-process implementation of the `emit` capability on
 * `TargetMigrationsCapability`.
 *
 * The CLI's `migration emit` (and `migration plan`'s inline emit) dispatches
 * here for any target that does not implement `resolveDescriptors`. Mongo's
 * `migration.ts` is authored as an executable class:
 *
 *     class MyMigration extends Migration { override plan() { return [...] } }
 *     export default MyMigration;
 *     Migration.run(import.meta.url, MyMigration);
 *
 * We dynamic-import the file (so that any structured errors thrown by
 * `placeholder(...)` propagate as real exceptions to the CLI), instantiate
 * the default-exported class, invoke `plan()`, and persist `ops.json` via the
 * framework I/O helper. `Migration.run` already guards itself against firing
 * when the file is imported rather than run as the main module, so this is
 * safe to call from inside the CLI process.
 *
 * Attestation (computing and writing `migrationId` to `manifest.json`) is
 * owned by the framework's `emitMigration` helper, not this capability.
 */

import { stat } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import {
  errorMigrationFileMissing,
  errorMigrationInvalidDefaultExport,
  errorMigrationPlanNotArray,
} from '@prisma-next/errors/migration';
import type {
  MigrationPlanOperation,
  TargetMigrationsCapability,
} from '@prisma-next/framework-components/control';
import { writeMigrationOps } from '@prisma-next/migration-tools/io';
import { Migration } from '@prisma-next/migration-tools/migration';
import { join } from 'pathe';

const MIGRATION_TS_FILE = 'migration.ts';

type EmitOptions = Parameters<NonNullable<TargetMigrationsCapability['emit']>>[0];

/**
 * Implementation of `TargetMigrationsCapability.emit` for Mongo.
 *
 * Loads `<dir>/migration.ts`, instantiates the default-exported `Migration`
 * subclass, calls `plan()` to produce the operations list, writes
 * `ops.json`, and returns the operations for the framework helper to render.
 * Attestation (`migrationId` in `manifest.json`) is the framework helper's
 * responsibility; this capability MUST NOT call `attestMigration` itself.
 */
export async function mongoEmit(options: EmitOptions): Promise<readonly MigrationPlanOperation[]> {
  const filePath = join(options.dir, MIGRATION_TS_FILE);

  try {
    await stat(filePath);
  } catch {
    throw errorMigrationFileMissing(options.dir);
  }

  const fileUrl = pathToFileURL(filePath).href;
  const mod = (await import(fileUrl)) as { default?: unknown };

  const MigrationClass = mod.default;
  if (typeof MigrationClass !== 'function') {
    throw errorMigrationInvalidDefaultExport(
      options.dir,
      `default export of type ${typeof MigrationClass}`,
    );
  }

  const instance = new (MigrationClass as new () => Migration)();
  if (!(instance instanceof Migration)) {
    throw errorMigrationInvalidDefaultExport(
      options.dir,
      'a default export that does not extend Migration (from @prisma-next/migration-tools/migration)',
    );
  }

  const operations = instance.plan() as readonly MigrationPlanOperation[];
  if (!Array.isArray(operations)) {
    throw errorMigrationPlanNotArray(options.dir, describeValue(operations));
  }

  await writeMigrationOps(options.dir, operations);

  return operations;
}

function describeValue(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  return `a value of type ${typeof value}`;
}
