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
  MigrationApplyEdge,
  MigrationApplyResult,
  OnControlProgress,
} from '../types';

export interface ExecuteMigrationApplyOptions<TFamilyId extends string, TTargetId extends string> {
  readonly driver: ControlDriverInstance<TFamilyId, TTargetId>;
  readonly familyInstance: ControlFamilyInstance<TFamilyId>;
  readonly pendingEdges: readonly MigrationApplyEdge[];
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
    pendingEdges,
    migrations,
    frameworkComponents,
    targetId,
    onProgress,
  } = options;

  const runner = migrations.createRunner(familyInstance);
  const policy = { allowedOperationClasses: ['additive'] as const };
  const applied: MigrationApplyAppliedEntry[] = [];

  for (const edge of pendingEdges) {
    const edgeSpanId = `migration:${edge.dirName}`;
    onProgress?.({
      action: 'migrationApply',
      kind: 'spanStart',
      spanId: edgeSpanId,
      label: `Applying ${edge.dirName}`,
    });

    // EMPTY_CONTRACT_HASH means "no prior state" — the runner expects origin: null
    // for a fresh database (no marker present).
    const plan = {
      targetId,
      origin: edge.from === EMPTY_CONTRACT_HASH ? null : { storageHash: edge.from },
      destination: { storageHash: edge.to },
      operations: edge.operations as readonly MigrationPlanOperation[],
    };

    const destinationContract = familyInstance.validateContractIR(edge.toContract as ContractIR);

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
        spanId: edgeSpanId,
        outcome: 'error',
      });
      return notOk({
        code: 'RUNNER_FAILED' as const,
        summary: runnerResult.failure.summary,
        why: runnerResult.failure.why,
        meta: {
          migration: edge.dirName,
          from: edge.from,
          to: edge.to,
          ...(runnerResult.failure.meta ?? {}),
        },
      });
    }

    onProgress?.({
      action: 'migrationApply',
      kind: 'spanEnd',
      spanId: edgeSpanId,
      outcome: 'ok',
    });

    applied.push({
      dirName: edge.dirName,
      from: edge.from,
      to: edge.to,
      operationsExecuted: runnerResult.value.operationsExecuted,
    });
  }

  const finalHash = pendingEdges[pendingEdges.length - 1]!.to;
  const totalOps = applied.reduce((sum, a) => sum + a.operationsExecuted, 0);

  return ok({
    migrationsApplied: applied.length,
    markerHash: finalHash,
    applied,
    summary: `Applied ${applied.length} migration(s) (${totalOps} operation(s)), marker at ${finalHash}`,
  });
}
