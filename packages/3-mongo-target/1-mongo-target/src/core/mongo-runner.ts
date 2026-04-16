import type { ContractMarkerRecord } from '@prisma-next/contract/types';
import type { TargetBoundComponentDescriptor } from '@prisma-next/framework-components/components';
import type {
  MigrationOperationPolicy,
  MigrationPlan,
  MigrationPlanOperation,
  MigrationRunnerExecutionChecks,
  MigrationRunnerFailure,
  MigrationRunnerResult,
} from '@prisma-next/framework-components/control';
import type {
  MongoDdlCommandVisitor,
  MongoInspectionCommandVisitor,
  MongoMigrationCheck,
  MongoMigrationPlanOperation,
} from '@prisma-next/mongo-query-ast/control';
import { notOk, ok } from '@prisma-next/utils/result';
import { FilterEvaluator } from './filter-evaluator';
import { deserializeMongoOps } from './mongo-ops-serializer';

export interface MarkerOperations {
  readMarker(): Promise<ContractMarkerRecord | null>;
  initMarker(destination: {
    readonly storageHash: string;
    readonly profileHash: string;
  }): Promise<void>;
  updateMarker(
    expectedFrom: string,
    destination: { readonly storageHash: string; readonly profileHash: string },
  ): Promise<boolean>;
  writeLedgerEntry(entry: {
    readonly edgeId: string;
    readonly from: string;
    readonly to: string;
  }): Promise<void>;
}

export interface MongoRunnerDependencies {
  readonly commandExecutor: MongoDdlCommandVisitor<Promise<void>>;
  readonly inspectionExecutor: MongoInspectionCommandVisitor<Promise<Record<string, unknown>[]>>;
  readonly markerOps: MarkerOperations;
}

function runnerFailure(
  code: string,
  summary: string,
  opts?: { why?: string; meta?: Record<string, unknown> },
): MigrationRunnerResult {
  return notOk<MigrationRunnerFailure>({
    code,
    summary,
    ...opts,
  });
}

export class MongoMigrationRunner {
  constructor(private readonly deps: MongoRunnerDependencies) {}

  async execute(options: {
    readonly plan: MigrationPlan;
    readonly destinationContract: unknown;
    readonly policy: MigrationOperationPolicy;
    readonly callbacks?: {
      onOperationStart?(op: MigrationPlanOperation): void;
      onOperationComplete?(op: MigrationPlanOperation): void;
    };
    readonly executionChecks?: MigrationRunnerExecutionChecks;
    readonly frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<'mongo', 'mongo'>>;
  }): Promise<MigrationRunnerResult> {
    const { commandExecutor, inspectionExecutor, markerOps } = this.deps;
    const operations = deserializeMongoOps(options.plan.operations as readonly unknown[]);

    const policyCheck = this.enforcePolicyCompatibility(options.policy, operations);
    if (policyCheck) return policyCheck;

    const existingMarker = await markerOps.readMarker();

    const markerCheck = this.ensureMarkerCompatibility(existingMarker, options.plan);
    if (markerCheck) return markerCheck;

    const checks = options.executionChecks;
    const runPrechecks = checks?.prechecks !== false;
    const runPostchecks = checks?.postchecks !== false;
    const runIdempotency = checks?.idempotencyChecks !== false;

    const filterEvaluator = new FilterEvaluator();

    let operationsExecuted = 0;

    for (const operation of operations) {
      options.callbacks?.onOperationStart?.(operation);
      try {
        if (runPostchecks && runIdempotency) {
          const allSatisfied = await this.allChecksSatisfied(
            operation.postcheck,
            inspectionExecutor,
            filterEvaluator,
          );
          if (allSatisfied) continue;
        }

        if (runPrechecks) {
          const precheckResult = await this.evaluateChecks(
            operation.precheck,
            inspectionExecutor,
            filterEvaluator,
          );
          if (!precheckResult) {
            return runnerFailure(
              'PRECHECK_FAILED',
              `Operation ${operation.id} failed during precheck`,
              { meta: { operationId: operation.id } },
            );
          }
        }

        for (const step of operation.execute) {
          await step.command.accept(commandExecutor);
        }

        if (runPostchecks) {
          const postcheckResult = await this.evaluateChecks(
            operation.postcheck,
            inspectionExecutor,
            filterEvaluator,
          );
          if (!postcheckResult) {
            return runnerFailure(
              'POSTCHECK_FAILED',
              `Operation ${operation.id} failed during postcheck`,
              { meta: { operationId: operation.id } },
            );
          }
        }

        operationsExecuted += 1;
      } finally {
        options.callbacks?.onOperationComplete?.(operation);
      }
    }

    const destination = options.plan.destination;
    const contract = options.destinationContract as { profileHash?: string };
    const profileHash = contract.profileHash ?? destination.storageHash;

    if (
      operationsExecuted === 0 &&
      existingMarker?.storageHash === destination.storageHash &&
      existingMarker.profileHash === profileHash
    ) {
      return ok({ operationsPlanned: operations.length, operationsExecuted });
    }

    if (existingMarker) {
      const updated = await markerOps.updateMarker(existingMarker.storageHash, {
        storageHash: destination.storageHash,
        profileHash,
      });
      if (!updated) {
        return runnerFailure(
          'MARKER_CAS_FAILURE',
          'Marker was modified by another process during migration execution.',
          {
            meta: {
              expectedStorageHash: existingMarker.storageHash,
              destinationStorageHash: destination.storageHash,
            },
          },
        );
      }
    } else {
      await markerOps.initMarker({
        storageHash: destination.storageHash,
        profileHash,
      });
    }

    const originHash = existingMarker?.storageHash ?? '';
    await markerOps.writeLedgerEntry({
      edgeId: `${originHash}->${destination.storageHash}`,
      from: originHash,
      to: destination.storageHash,
    });

    return ok({ operationsPlanned: operations.length, operationsExecuted });
  }

  private async evaluateChecks(
    checks: readonly MongoMigrationCheck[],
    inspectionExecutor: MongoInspectionCommandVisitor<Promise<Record<string, unknown>[]>>,
    filterEvaluator: FilterEvaluator,
  ): Promise<boolean> {
    for (const check of checks) {
      const documents = await check.source.accept(inspectionExecutor);
      const matchFound = documents.some((doc) =>
        filterEvaluator.evaluate(check.filter, doc as Record<string, unknown>),
      );
      const passed = check.expect === 'exists' ? matchFound : !matchFound;
      if (!passed) return false;
    }
    return true;
  }

  private async allChecksSatisfied(
    checks: readonly MongoMigrationCheck[],
    inspectionExecutor: MongoInspectionCommandVisitor<Promise<Record<string, unknown>[]>>,
    filterEvaluator: FilterEvaluator,
  ): Promise<boolean> {
    if (checks.length === 0) return false;
    return this.evaluateChecks(checks, inspectionExecutor, filterEvaluator);
  }

  private enforcePolicyCompatibility(
    policy: MigrationOperationPolicy,
    operations: readonly MongoMigrationPlanOperation[],
  ): MigrationRunnerResult | undefined {
    const allowedClasses = new Set(policy.allowedOperationClasses);
    for (const operation of operations) {
      if (!allowedClasses.has(operation.operationClass)) {
        return runnerFailure(
          'POLICY_VIOLATION',
          `Operation ${operation.id} has class "${operation.operationClass}" which is not allowed by policy.`,
          {
            why: `Policy only allows: ${[...allowedClasses].join(', ')}.`,
            meta: {
              operationId: operation.id,
              operationClass: operation.operationClass,
            },
          },
        );
      }
    }
    return undefined;
  }

  private ensureMarkerCompatibility(
    marker: ContractMarkerRecord | null,
    plan: MigrationPlan,
  ): MigrationRunnerResult | undefined {
    const origin = plan.origin ?? null;
    if (!origin) {
      if (marker) {
        return runnerFailure(
          'MARKER_ORIGIN_MISMATCH',
          'Database already has a contract marker but the plan has no origin. This would silently overwrite the existing marker.',
          { meta: { markerStorageHash: marker.storageHash } },
        );
      }
      return undefined;
    }

    if (!marker) {
      return runnerFailure(
        'MARKER_ORIGIN_MISMATCH',
        `Missing contract marker: expected origin storage hash ${origin.storageHash}.`,
        { meta: { expectedOriginStorageHash: origin.storageHash } },
      );
    }

    if (marker.storageHash !== origin.storageHash) {
      return runnerFailure(
        'MARKER_ORIGIN_MISMATCH',
        `Existing contract marker (${marker.storageHash}) does not match plan origin (${origin.storageHash}).`,
        {
          meta: {
            markerStorageHash: marker.storageHash,
            expectedOriginStorageHash: origin.storageHash,
          },
        },
      );
    }

    return undefined;
  }
}
