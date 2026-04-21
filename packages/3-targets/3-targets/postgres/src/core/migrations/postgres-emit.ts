/**
 * Postgres's in-process implementation of the `emit` capability on
 * `TargetMigrationsCapability`. Symmetric with Mongo's `mongo-emit.ts` —
 * see that module's preamble for the cross-cutting emit story.
 *
 * Postgres-specific responsibilities:
 *
 *  - Accept two authoring shapes for `migration.ts`'s default export:
 *
 *      1. Class subclass (canonical, scaffolded form):
 *           class M extends Migration { ... }
 *           export default M;
 *           Migration.run(import.meta.url, M);
 *
 *      2. Factory function returning a MigrationPlan-shaped object.
 *
 *  - Dynamic-import the file so structured errors thrown during evaluation
 *    (notably `placeholder(...)` / `PN-MIG-2001`) surface to the CLI as
 *    real exceptions.
 *  - Persist `ops.json` via `writeMigrationOps` and return the operations
 *    to the caller. Attestation of `migration.json` is the caller's job.
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

export async function postgresEmit(
  options: EmitOptions,
): Promise<readonly MigrationPlanOperation[]> {
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
