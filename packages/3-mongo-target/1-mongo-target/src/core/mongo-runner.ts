import type { ContractMarkerRecord } from '@prisma-next/contract/types';
import { errorRunnerFailed } from '@prisma-next/errors/execution';
import type { TargetBoundComponentDescriptor } from '@prisma-next/framework-components/components';
import type {
  MigrationOperationPolicy,
  MigrationPlan,
  MigrationPlanOperation,
  MigrationRunnerExecutionChecks,
  MigrationRunnerFailure,
  MigrationRunnerResult,
  OperationContext,
} from '@prisma-next/framework-components/control';
import type { MongoContract } from '@prisma-next/mongo-contract';
import type { MongoAdapter, MongoDriver } from '@prisma-next/mongo-lowering';
import type {
  AnyMongoMigrationOperation,
  MongoDataTransformCheck,
  MongoDataTransformOperation,
  MongoDdlCommandVisitor,
  MongoInspectionCommandVisitor,
  MongoMigrationCheck,
  MongoMigrationPlanOperation,
} from '@prisma-next/mongo-query-ast/control';
import type { MongoSchemaIR } from '@prisma-next/mongo-schema-ir';
import { notOk, ok } from '@prisma-next/utils/result';
import { FilterEvaluator } from './filter-evaluator';
import { deserializeMongoOps } from './mongo-ops-serializer';
import { verifyMongoSchema } from './schema-verify/verify-mongo-schema';

const READ_ONLY_CHECK_COMMAND_KINDS: ReadonlySet<string> = new Set(['aggregate', 'rawAggregate']);

export interface MarkerOperations {
  readMarker(): Promise<ContractMarkerRecord | null>;
  initMarker(destination: {
    readonly storageHash: string;
    readonly profileHash: string;
    readonly invariants?: readonly string[];
  }): Promise<void>;
  updateMarker(
    expectedFrom: string,
    destination: {
      readonly storageHash: string;
      readonly profileHash: string;
      readonly invariants?: readonly string[];
    },
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
  readonly adapter: MongoAdapter;
  readonly driver: MongoDriver;
  readonly markerOps: MarkerOperations;
  readonly introspectSchema: () => Promise<MongoSchemaIR>;
}

export interface MongoMigrationRunnerExecuteOptions {
  readonly plan: MigrationPlan;
  readonly destinationContract: MongoContract;
  readonly policy: MigrationOperationPolicy;
  readonly callbacks?: {
    onOperationStart?(op: MigrationPlanOperation): void;
    onOperationComplete?(op: MigrationPlanOperation): void;
  };
  readonly executionChecks?: MigrationRunnerExecutionChecks;
  readonly frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<'mongo', 'mongo'>>;
  readonly strictVerification?: boolean;
  readonly context?: OperationContext;
  /**
   * Invariant ids contributed by this apply (the migration's `providedInvariants`).
   * The runner unions these into `marker.invariants` atomically with the marker write.
   * Defaults to `[]` for marker-only flows.
   */
  readonly invariants?: readonly string[];
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

function unionInvariants(
  existing: readonly string[],
  incoming: readonly string[],
): readonly string[] {
  return Array.from(new Set([...existing, ...incoming])).sort();
}

export class MongoMigrationRunner {
  constructor(private readonly deps: MongoRunnerDependencies) {}

  async execute(options: MongoMigrationRunnerExecuteOptions): Promise<MigrationRunnerResult> {
    const { commandExecutor, inspectionExecutor, adapter, driver, markerOps } = this.deps;
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
        if (operation.operationClass === 'data') {
          const result = await this.executeDataTransform(
            operation as MongoDataTransformOperation,
            adapter,
            driver,
            filterEvaluator,
            runIdempotency,
            runPrechecks,
            runPostchecks,
          );
          if (result.failure) return result.failure;
          if (result.executed) operationsExecuted += 1;
          continue;
        }

        const ddlOp = operation as MongoMigrationPlanOperation;

        if (runPostchecks && runIdempotency) {
          const allSatisfied = await this.allChecksSatisfied(
            ddlOp.postcheck,
            inspectionExecutor,
            filterEvaluator,
          );
          if (allSatisfied) continue;
        }

        if (runPrechecks) {
          const precheckResult = await this.evaluateChecks(
            ddlOp.precheck,
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

        for (const step of ddlOp.execute) {
          await step.command.accept(commandExecutor);
        }

        if (runPostchecks) {
          const postcheckResult = await this.evaluateChecks(
            ddlOp.postcheck,
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
    const profileHash = options.destinationContract.profileHash ?? destination.storageHash;

    if (
      operationsExecuted === 0 &&
      existingMarker?.storageHash === destination.storageHash &&
      existingMarker.profileHash === profileHash
    ) {
      return ok({ operationsPlanned: operations.length, operationsExecuted });
    }

    const liveSchema = await this.deps.introspectSchema();
    const verifyResult = verifyMongoSchema({
      contract: options.destinationContract,
      schema: liveSchema,
      strict: options.strictVerification ?? true,
      frameworkComponents: options.frameworkComponents,
      ...(options.context ? { context: options.context } : {}),
    });
    if (!verifyResult.ok) {
      return runnerFailure('SCHEMA_VERIFY_FAILED', verifyResult.summary, {
        why: 'The resulting database schema does not satisfy the destination contract.',
        meta: { issues: verifyResult.schema.issues },
      });
    }

    const unionedInvariants = unionInvariants(
      existingMarker?.invariants ?? [],
      options.invariants ?? [],
    );

    if (existingMarker) {
      const updated = await markerOps.updateMarker(existingMarker.storageHash, {
        storageHash: destination.storageHash,
        profileHash,
        invariants: unionedInvariants,
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
        invariants: unionedInvariants,
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

  private async executeDataTransform(
    op: MongoDataTransformOperation,
    adapter: MongoAdapter,
    driver: MongoDriver,
    filterEvaluator: FilterEvaluator,
    runIdempotency: boolean,
    runPrechecks: boolean,
    runPostchecks: boolean,
  ): Promise<{ executed: boolean; failure?: MigrationRunnerResult }> {
    if (runPostchecks && runIdempotency && op.postcheck.length > 0) {
      const allSatisfied = await this.evaluateDataTransformChecks(
        op.postcheck,
        adapter,
        driver,
        filterEvaluator,
      );
      if (allSatisfied) return { executed: false };
    }

    if (runPrechecks && op.precheck.length > 0) {
      const passed = await this.evaluateDataTransformChecks(
        op.precheck,
        adapter,
        driver,
        filterEvaluator,
      );
      if (!passed) {
        return {
          executed: false,
          failure: runnerFailure('PRECHECK_FAILED', `Operation ${op.id} failed during precheck`, {
            meta: { operationId: op.id, name: op.name },
          }),
        };
      }
    }

    for (const plan of op.run) {
      const wireCommand = adapter.lower(plan);
      for await (const _ of driver.execute(wireCommand)) {
        /* consume */
      }
    }

    if (runPostchecks && op.postcheck.length > 0) {
      const passed = await this.evaluateDataTransformChecks(
        op.postcheck,
        adapter,
        driver,
        filterEvaluator,
      );
      if (!passed) {
        return {
          executed: false,
          failure: runnerFailure('POSTCHECK_FAILED', `Operation ${op.id} failed during postcheck`, {
            meta: { operationId: op.id, name: op.name },
          }),
        };
      }
    }

    return { executed: true };
  }

  private async evaluateDataTransformChecks(
    checks: readonly MongoDataTransformCheck[],
    adapter: MongoAdapter,
    driver: MongoDriver,
    filterEvaluator: FilterEvaluator,
  ): Promise<boolean> {
    for (const check of checks) {
      const commandKind = check.source.command.kind;
      if (!READ_ONLY_CHECK_COMMAND_KINDS.has(commandKind)) {
        throw errorRunnerFailed(
          `Data-transform check rejected: command kind "${commandKind}" is not read-only`,
          {
            why: 'Data-transform checks must use aggregate or rawAggregate commands so the pre/postcheck path cannot mutate the database.',
            fix: 'Author the check.source as an aggregate pipeline (or rawAggregate) rather than a DML write command.',
            meta: {
              checkDescription: check.description,
              commandKind,
              collection: check.source.collection,
            },
          },
        );
      }
      const wireCommand = adapter.lower(check.source);
      let matchFound = false;
      for await (const row of driver.execute<Record<string, unknown>>(wireCommand)) {
        if (filterEvaluator.evaluate(check.filter, row)) {
          matchFound = true;
          break;
        }
      }
      const passed = check.expect === 'exists' ? matchFound : !matchFound;
      if (!passed) return false;
    }
    return true;
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
    operations: readonly AnyMongoMigrationOperation[],
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
