import type { TargetBoundComponentDescriptor } from '@prisma-next/contract/framework-components';
import type { ContractIR } from '@prisma-next/contract/ir';
import { EMPTY_CONTRACT_HASH } from '@prisma-next/core-control-plane/constants';
import type {
  ControlDriverInstance,
  ControlFamilyInstance,
  MigrationPlanOperation,
  MigrationRunnerResult,
  TargetMigrationsCapability,
} from '@prisma-next/core-control-plane/types';
import { notOk, ok } from '@prisma-next/utils/result';
import type {
  MigrationApplyAppliedEntry,
  MigrationApplyResult,
  MigrationApplyStep,
  OnControlProgress,
} from '../types';

export interface ExecuteMigrationApplyOptions<TFamilyId extends string, TTargetId extends string> {
  readonly driver: ControlDriverInstance<TFamilyId, TTargetId>;
  readonly familyInstance: ControlFamilyInstance<TFamilyId>;
  readonly originHash: string;
  readonly destinationHash: string;
  readonly pendingMigrations: readonly MigrationApplyStep[];
  readonly migrations: TargetMigrationsCapability<
    TFamilyId,
    TTargetId,
    ControlFamilyInstance<TFamilyId>
  >;
  readonly frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<TFamilyId, TTargetId>>;
  readonly targetId: string;
  readonly onProgress?: OnControlProgress;
}

export async function executeMigrationApply<TFamilyId extends string, TTargetId extends string>(
  options: ExecuteMigrationApplyOptions<TFamilyId, TTargetId>,
): Promise<MigrationApplyResult> {
  const {
    driver,
    familyInstance,
    originHash,
    destinationHash,
    pendingMigrations,
    migrations,
    frameworkComponents,
    targetId,
    onProgress,
  } = options;

  if (pendingMigrations.length === 0) {
    if (originHash !== destinationHash) {
      return notOk({
        code: 'MIGRATION_PATH_NOT_FOUND' as const,
        summary: 'No migrations provided for requested origin and destination',
        why: `Requested ${originHash} -> ${destinationHash} but pendingMigrations is empty`,
        meta: { originHash, destinationHash },
      });
    }
    return ok({
      migrationsApplied: 0,
      markerHash: originHash,
      applied: [],
      summary: 'Already up to date',
    });
  }

  const firstMigration = pendingMigrations[0]!;
  const lastMigration = pendingMigrations[pendingMigrations.length - 1]!;
  if (firstMigration.from !== originHash || lastMigration.to !== destinationHash) {
    return notOk({
      code: 'MIGRATION_PATH_NOT_FOUND' as const,
      summary: 'Migration apply path does not match requested origin and destination',
      why: `Path resolved as ${firstMigration.from} -> ${lastMigration.to}, but requested ${originHash} -> ${destinationHash}`,
      meta: {
        originHash,
        destinationHash,
        pathOrigin: firstMigration.from,
        pathDestination: lastMigration.to,
      },
    });
  }

  for (let i = 1; i < pendingMigrations.length; i++) {
    const previous = pendingMigrations[i - 1]!;
    const current = pendingMigrations[i]!;
    if (previous.to !== current.from) {
      return notOk({
        code: 'MIGRATION_PATH_NOT_FOUND' as const,
        summary: 'Migration apply path contains a discontinuity between adjacent migrations',
        why: `Migration "${previous.dirName}" ends at ${previous.to}, but next migration "${current.dirName}" starts at ${current.from}`,
        meta: {
          originHash,
          destinationHash,
          previousDirName: previous.dirName,
          previousTo: previous.to,
          currentDirName: current.dirName,
          currentFrom: current.from,
          discontinuityIndex: i,
        },
      });
    }
  }

  const runner = migrations.createRunner(familyInstance);
  const applied: MigrationApplyAppliedEntry[] = [];

  for (const migration of pendingMigrations) {
    const migrationSpanId = `migration:${migration.dirName}`;
    onProgress?.({
      action: 'migrationApply',
      kind: 'spanStart',
      spanId: migrationSpanId,
      label: `Applying ${migration.dirName}`,
    });

    const operations = migration.operations as readonly MigrationPlanOperation[];

    // Allow all operation classes. The policy gate belongs at plan time, not
    // apply time — the planner already decided what to emit. Restricting here
    // would be a tautology (the allowed set would just mirror what's in ops).
    const policy = {
      allowedOperationClasses: ['additive', 'widening', 'destructive'] as const,
    };

    // EMPTY_CONTRACT_HASH means "no prior state" — the runner expects origin: null
    // for a fresh database (no marker present).
    const plan = {
      targetId,
      origin: migration.from === EMPTY_CONTRACT_HASH ? null : { storageHash: migration.from },
      destination: { storageHash: migration.to },
      operations,
    };

    const destinationContract = familyInstance.validateContractIR(
      migration.toContract as ContractIR,
    );

    const runnerResult: MigrationRunnerResult = await runner.execute({
      plan,
      driver,
      destinationContract,
      policy,
      executionChecks: {
        prechecks: true,
        postchecks: true,
        idempotencyChecks: true,
      },
      frameworkComponents,
    });

    if (!runnerResult.ok) {
      onProgress?.({
        action: 'migrationApply',
        kind: 'spanEnd',
        spanId: migrationSpanId,
        outcome: 'error',
      });
      return notOk({
        code: 'RUNNER_FAILED' as const,
        summary: runnerResult.failure.summary,
        why: runnerResult.failure.why,
        meta: {
          migration: migration.dirName,
          from: migration.from,
          to: migration.to,
          ...(runnerResult.failure.meta ?? {}),
        },
      });
    }

    onProgress?.({
      action: 'migrationApply',
      kind: 'spanEnd',
      spanId: migrationSpanId,
      outcome: 'ok',
    });

    applied.push({
      dirName: migration.dirName,
      from: migration.from,
      to: migration.to,
      operationsExecuted: runnerResult.value.operationsExecuted,
    });
  }

  const finalHash = pendingMigrations[pendingMigrations.length - 1]!.to;
  const totalOps = applied.reduce((sum, a) => sum + a.operationsExecuted, 0);

  return ok({
    migrationsApplied: applied.length,
    markerHash: finalHash,
    applied,
    summary: `Applied ${applied.length} migration(s) (${totalOps} operation(s)), marker at ${finalHash}`,
  });
}
