/**
 * Mongo's in-process implementation of the `emit` capability on
 * `TargetMigrationsCapability`.
 *
 * The CLI's `migration emit` (and `migration plan`'s inline emit) dispatches
 * here for any target that does not implement `resolveDescriptors`. Two
 * authoring shapes are accepted, both of which adhere to the `MigrationPlan`
 * interface:
 *
 *   1. Class subclass (canonical, scaffolded form):
 *        class M extends Migration {
 *          override get operations() { return [...]; }
 *          override describe() { return { from, to }; }
 *        }
 *        export default M;
 *        Migration.run(import.meta.url, M);
 *
 *   2. Factory function returning a MigrationPlan-shaped object:
 *        export default () => ({
 *          targetId: 'mongo',
 *          destination: { storageHash: '...' },
 *          operations: [createCollection("users")],
 *        });
 *
 * Only the class form is scaffolded; the factory form is supported for
 * authors who prefer it. We dynamic-import the file (so that any structured
 * errors thrown by `placeholder(...)` propagate as real exceptions to the
 * CLI), dispatch on the export's shape (class subclass vs. callable factory),
 * and persist `ops.json` via the framework I/O helper. `Migration.run`
 * already guards itself against firing when the file is imported rather than
 * run as the main module, so it is a no-op on this code path; the
 * framework's `emitMigration` helper attests `migration.json` after we
 * return. The canonical (shebang) path attests itself inside `Migration.run`
 * — both paths converge on byte-identical artifacts.
 */

import { stat } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import {
  errorMigrationFileMissing,
  errorMigrationInvalidDefaultExport,
  errorMigrationPlanNotArray,
} from '@prisma-next/errors/migration';
import type {
  MigrationPlan,
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
 * if it is a `Migration` subclass, instantiates it; otherwise invokes it as a
 * factory function (sync or async) and validates the returned value is
 * `MigrationPlan`-shaped. In both cases reads `.operations` to produce the
 * operations list, writes `ops.json`, and returns the operations for the
 * framework helper to render. Attestation of `migration.json` is the
 * caller's responsibility: the framework's `emitMigration` helper calls
 * `attestMigration` after this function returns. This capability MUST NOT
 * call `attestMigration` itself, to avoid double-attestation when the helper
 * drives emit.
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

  let plan: MigrationPlan;
  if (MigrationExport.prototype instanceof Migration) {
    plan = new (MigrationExport as new () => Migration)();
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
      !('operations' in factoryResult)
    ) {
      throw errorMigrationInvalidDefaultExport(
        options.dir,
        `factory must return a MigrationPlan-shaped object; got ${describeValue(factoryResult)}`,
      );
    }
    plan = factoryResult as MigrationPlan;
  }

  const operations: unknown = plan.operations;
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
