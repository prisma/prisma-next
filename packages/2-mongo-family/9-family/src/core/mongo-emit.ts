/**
 * Mongo's in-process implementation of the `emit` capability on
 * `TargetMigrationsCapability`.
 *
 * The CLI's `migration emit` (and `migration plan`'s inline emit) dispatches
 * here for any target that does not implement `resolveDescriptors`. Two
 * authoring shapes are accepted:
 *
 *   1. Class subclass (canonical):
 *        class M extends Migration { override plan() { return [...] } }
 *        export default M;
 *        Migration.run(import.meta.url, M);
 *
 *   2. Factory function returning a Migration-satisfying object:
 *        export default () => ({ plan() { return [createCollection("users")] } });
 *
 * We dynamic-import the file (so that any structured errors thrown by
 * `placeholder(...)` propagate as real exceptions to the CLI), dispatch on
 * the export's shape (class subclass vs. callable function), and persist
 * `ops.json` via the framework I/O helper. `Migration.run` already guards
 * itself against firing when the file is imported rather than run as the
 * main module, so this is safe to call from inside the CLI process.
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
 * Loads `<dir>/migration.ts` and dispatches on the default export's shape:
 * if it is a `Migration` subclass, instantiates it and calls `plan()`;
 * otherwise invokes it as a factory function, validates the returned value
 * has a `plan()` method, and calls it.
 * Writes `ops.json` and returns the operations for the framework helper to
 * render. Attestation (`migrationId` in `manifest.json`) is the framework
 * helper's responsibility; this capability MUST NOT call `attestMigration`
 * itself.
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

  const MigrationExport = mod.default;
  if (typeof MigrationExport !== 'function') {
    throw errorMigrationInvalidDefaultExport(
      options.dir,
      `default export of type ${typeof MigrationExport}`,
    );
  }

  let migration: { plan(): unknown };
  if (MigrationExport.prototype instanceof Migration) {
    migration = new (MigrationExport as new () => Migration)();
  } else {
    let factoryResult: unknown;
    try {
      factoryResult = await (MigrationExport as () => unknown | Promise<unknown>)();
    } catch (error) {
      if (error instanceof TypeError && /cannot be invoked without 'new'/i.test(error.message)) {
        throw errorMigrationInvalidDefaultExport(
          options.dir,
          'a default export that does not extend Migration (from @prisma-next/migration-tools/migration)',
        );
      }
      throw error;
    }
    if (
      typeof factoryResult !== 'object' ||
      factoryResult === null ||
      typeof (factoryResult as { plan?: unknown }).plan !== 'function'
    ) {
      throw errorMigrationInvalidDefaultExport(
        options.dir,
        `factory must return an object with a plan() method; got ${describeValue(factoryResult)}`,
      );
    }
    migration = factoryResult as { plan(): unknown };
  }

  const operations: unknown = migration.plan();

  if (!Array.isArray(operations)) {
    throw errorMigrationPlanNotArray(options.dir, describeValue(operations));
  }

  await writeMigrationOps(options.dir, operations);

  return operations;
}

function describeValue(value: unknown): string {
  if (value === null) return 'null';
  return `a value of type ${typeof value}`;
}
