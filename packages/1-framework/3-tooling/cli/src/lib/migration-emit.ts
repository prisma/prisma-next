/**
 * Shared helper for emitting `ops.json` from a migration package's
 * `migration.ts`.
 *
 * Two flows are dispatched here:
 *  - Descriptor flow (Postgres): the framework evaluates `migration.ts` (which
 *    re-exports the planner's descriptor list), calls the target's
 *    `resolveDescriptors` to produce display-oriented operations, and writes
 *    `ops.json` + `manifest.json`.
 *  - Class flow (Mongo): the target owns the source-loading and ops
 *    serialization step via its `emit` capability. The capability
 *    dynamic-imports `migration.ts`, invokes its class to produce
 *    operations, and calls `writeMigrationOps`. The framework helper
 *    then attests the package (single source of truth for
 *    `migrationId`).
 *
 * Used by `migration emit` (always) and `migration plan` (always, after
 * scaffolding `migration.ts`). Both flows run in-process so that structured
 * errors thrown during evaluation propagate as real exceptions and the
 * CLI's error envelope renders them with full structured metadata.
 */

import assert from 'node:assert/strict';
import type { TargetBoundComponentDescriptor } from '@prisma-next/framework-components/components';
import type {
  MigrationPlanOperation,
  OperationDescriptor,
  TargetMigrationsCapability,
} from '@prisma-next/framework-components/control';
import { attestMigration } from '@prisma-next/migration-tools/attestation';
import { readMigrationPackage, writeMigrationOps } from '@prisma-next/migration-tools/io';
import { evaluateMigrationTs, hasMigrationTs } from '@prisma-next/migration-tools/migration-ts';
import { errorMigrationFileMissing, errorTargetMigrationNotSupported } from '../utils/cli-errors';

/**
 * Context passed to `emitMigration`. Captures everything the helper needs to
 * dispatch to the right flow without re-loading the config.
 */
export interface EmitMigrationContext {
  readonly targetId: string;
  readonly migrations: TargetMigrationsCapability;
  readonly frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<string, string>>;
}

/**
 * Result of a successful emit: the operations that were written to `ops.json`
 * (display-oriented shape) and the content-addressed migrationId persisted to
 * `manifest.json`.
 */
export interface EmitMigrationResult {
  readonly operations: readonly MigrationPlanOperation[];
  readonly migrationId: string;
}

/**
 * Emit `ops.json` and attest `migrationId` for the migration package at `dir`.
 *
 * Dispatches to descriptor flow when the target implements `resolveDescriptors`,
 * otherwise to the target's `emit` capability. Throws a structured error if
 * `migration.ts` is missing or the target supports neither flow. Other
 * structured errors thrown during evaluation propagate unchanged.
 */
export async function emitMigration(
  dir: string,
  ctx: EmitMigrationContext,
): Promise<EmitMigrationResult> {
  if (!(await hasMigrationTs(dir))) {
    throw errorMigrationFileMissing(dir);
  }

  if (ctx.migrations.resolveDescriptors) {
    return emitDescriptorFlow(dir, ctx.migrations, ctx);
  }

  if (ctx.migrations.emit) {
    const operations = await ctx.migrations.emit({
      dir,
      frameworkComponents: ctx.frameworkComponents,
    });
    const migrationId = await attestMigration(dir);
    return { operations, migrationId };
  }

  throw errorTargetMigrationNotSupported({
    why: `Target "${ctx.targetId}" does not implement resolveDescriptors or emit; cannot emit a migration package`,
  });
}

/**
 * Descriptor flow: evaluate `migration.ts` to obtain a list of operation
 * descriptors, hand them to the target's `resolveDescriptors` along with the
 * manifest's contract bookends, then persist `ops.json` and attest the package.
 */
async function emitDescriptorFlow(
  dir: string,
  migrations: TargetMigrationsCapability,
  ctx: EmitMigrationContext,
): Promise<EmitMigrationResult> {
  assert(
    migrations.resolveDescriptors,
    'emitDescriptorFlow requires resolveDescriptors; gated by caller',
  );
  const pkg = await readMigrationPackage(dir);
  const descriptors = await evaluateMigrationTs(dir);
  const operations = migrations.resolveDescriptors(descriptors as OperationDescriptor[], {
    fromContract: pkg.manifest.fromContract,
    toContract: pkg.manifest.toContract,
    frameworkComponents: ctx.frameworkComponents,
  });
  await writeMigrationOps(dir, operations);
  const migrationId = await attestMigration(dir);
  return { operations, migrationId };
}
