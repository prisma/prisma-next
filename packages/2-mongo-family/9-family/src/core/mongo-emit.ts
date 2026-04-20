/**
 * Mongo's in-process implementation of the `emit` capability on
 * `TargetMigrationsCapability`. Invoked by the framework's class-flow emit
 * dispatcher in `@prisma-next/cli/lib/migration-emit` — see that module's
 * preamble for the cross-cutting story (when the CLI dispatches here, who
 * attests `migration.json`, why both flows produce byte-identical artifacts,
 * and the relationship to the self-emitting `Migration.run` shebang path).
 *
 * Mongo-specific responsibilities of this helper:
 *
 *  - Accept two authoring shapes for `migration.ts`'s default export, both
 *    adhering to the `MigrationPlan` interface:
 *
 *      1. Class subclass (canonical, scaffolded form):
 *           class M extends Migration {
 *             override get operations() { return [...]; }
 *             override describe() { return { from, to }; }
 *           }
 *           export default M;
 *           Migration.run(import.meta.url, M);
 *
 *      2. Factory function returning a MigrationPlan-shaped object:
 *           export default () => ({
 *             targetId: 'mongo',
 *             destination: { storageHash: '...' },
 *             operations: [createCollection("users")],
 *           });
 *
 *    Only the class form is scaffolded; the factory form is supported for
 *    authors who prefer it.
 *  - Dynamic-import the file so structured errors thrown during evaluation
 *    (notably `placeholder(...)`) surface to the CLI as real exceptions.
 *  - Dispatch on the default export's shape and validate the factory return
 *    is `MigrationPlan`-shaped.
 *  - Persist `ops.json` via the framework I/O helper and return the
 *    operations to the caller (which performs attestation).
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
