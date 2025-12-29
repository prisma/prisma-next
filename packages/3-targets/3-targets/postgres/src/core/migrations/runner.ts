import type { ContractMarkerRecord } from '@prisma-next/contract/types';
import type { Result } from '@prisma-next/core-control-plane/result';
import { ok, okVoid } from '@prisma-next/core-control-plane/result';
import type {
  MigrationOperationPolicy,
  MigrationPlanContractInfo,
  MigrationPlanOperation,
  MigrationPlanOperationStep,
  MigrationRunner,
  MigrationRunnerExecuteOptions,
  MigrationRunnerFailure,
  MigrationRunnerResult,
  SchemaVerifyOptions,
  SqlControlFamilyInstance,
} from '@prisma-next/family-sql/control';
import { runnerFailure, runnerSuccess } from '@prisma-next/family-sql/control';
import { readMarker } from '@prisma-next/family-sql/verify';
import type { PostgresPlanTargetDetails } from './planner';
import {
  buildLedgerInsertStatement,
  buildWriteMarkerStatements,
  ensureLedgerTableStatement,
  ensureMarkerTableStatement,
  ensurePrismaContractSchemaStatement,
  type SqlStatement,
} from './statement-builders';

interface RunnerConfig {
  readonly defaultSchema: string;
}

interface ApplyPlanSuccessValue {
  readonly operationsExecuted: number;
  readonly executedOperations: readonly MigrationPlanOperation<PostgresPlanTargetDetails>[];
}

const DEFAULT_CONFIG: RunnerConfig = {
  defaultSchema: 'public',
};

const LOCK_DOMAIN = 'prisma_next.contract.marker';

/**
 * Deep clones and freezes a record object to prevent mutation.
 * Recursively clones nested objects and arrays to ensure complete isolation.
 */
function cloneAndFreezeRecord<T extends Record<string, unknown>>(value: T): T {
  const cloned: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) {
    if (val === null || val === undefined) {
      cloned[key] = val;
    } else if (Array.isArray(val)) {
      // Clone array (shallow clone of array elements)
      cloned[key] = Object.freeze([...val]);
    } else if (typeof val === 'object') {
      // Recursively clone nested objects
      cloned[key] = cloneAndFreezeRecord(val as Record<string, unknown>);
    } else {
      // Primitives are copied as-is
      cloned[key] = val;
    }
  }
  return Object.freeze(cloned) as T;
}

export function createPostgresMigrationRunner(
  family: SqlControlFamilyInstance,
  config: Partial<RunnerConfig> = {},
): MigrationRunner<PostgresPlanTargetDetails> {
  return new PostgresMigrationRunner(family, { ...DEFAULT_CONFIG, ...config });
}

class PostgresMigrationRunner implements MigrationRunner<PostgresPlanTargetDetails> {
  constructor(
    private readonly family: SqlControlFamilyInstance,
    private readonly config: RunnerConfig,
  ) {}

  async execute(
    options: MigrationRunnerExecuteOptions<PostgresPlanTargetDetails>,
  ): Promise<MigrationRunnerResult> {
    const schema = options.schemaName ?? this.config.defaultSchema;
    const driver = options.driver;
    const lockKey = `${LOCK_DOMAIN}:${schema}`;

    // Static checks - fail fast before transaction
    const destinationCheck = this.ensurePlanMatchesDestinationContract(
      options.plan.destination,
      options.destinationContract,
    );
    if (!destinationCheck.ok) {
      return destinationCheck;
    }

    const policyCheck = this.enforcePolicyCompatibility(options.policy, options.plan.operations);
    if (!policyCheck.ok) {
      return policyCheck;
    }

    // Begin transaction for DB operations
    await this.beginTransaction(driver);
    let committed = false;
    try {
      await this.acquireLock(driver, lockKey);
      await this.ensureControlTables(driver);
      const existingMarker = await readMarker(driver);

      // Validate plan origin matches existing marker (needs marker from DB)
      const markerCheck = this.ensureMarkerCompatibility(existingMarker, options.plan);
      if (!markerCheck.ok) {
        return markerCheck;
      }

      // Apply plan operations or skip if marker already at destination
      const markerAtDestination = this.markerMatchesDestination(existingMarker, options.plan);
      let applyValue: ApplyPlanSuccessValue;

      if (markerAtDestination) {
        applyValue = { operationsExecuted: 0, executedOperations: [] };
      } else {
        const applyResult = await this.applyPlan(driver, options);
        if (!applyResult.ok) {
          return applyResult;
        }
        applyValue = applyResult.value;
      }

      // Verify resulting schema matches contract
      const schemaVerifyOptions: SchemaVerifyOptions = {
        driver,
        contractIR: options.destinationContract,
        strict: options.strictVerification ?? true,
        context: options.context ?? {},
      };
      const schemaVerifyResult = await this.family.schemaVerify(schemaVerifyOptions);
      if (!schemaVerifyResult.ok) {
        return runnerFailure('SCHEMA_VERIFY_FAILED', schemaVerifyResult.summary, {
          why: 'The resulting database schema does not satisfy the destination contract.',
          meta: {
            issues: schemaVerifyResult.schema.issues,
          },
        });
      }

      // Record marker and ledger entries
      await this.upsertMarker(driver, options, existingMarker);
      await this.recordLedgerEntry(driver, options, existingMarker, applyValue.executedOperations);

      await this.commitTransaction(driver);
      committed = true;
      return runnerSuccess({
        operationsPlanned: options.plan.operations.length,
        operationsExecuted: applyValue.operationsExecuted,
      });
    } finally {
      if (!committed) {
        await this.rollbackTransaction(driver);
      }
    }
  }

  private async applyPlan(
    driver: MigrationRunnerExecuteOptions<PostgresPlanTargetDetails>['driver'],
    options: MigrationRunnerExecuteOptions<PostgresPlanTargetDetails>,
  ): Promise<Result<ApplyPlanSuccessValue, MigrationRunnerFailure>> {
    let operationsExecuted = 0;
    const executedOperations: Array<MigrationPlanOperation<PostgresPlanTargetDetails>> = [];
    for (const operation of options.plan.operations) {
      options.callbacks?.onOperationStart?.(operation);
      try {
        const postcheckAlreadySatisfied = await this.expectationsAreSatisfied(
          driver,
          operation.postcheck,
        );
        if (postcheckAlreadySatisfied) {
          executedOperations.push(this.createPostcheckPreSatisfiedSkipRecord(operation));
          continue;
        }

        const precheckResult = await this.runExpectationSteps(
          driver,
          operation.precheck,
          operation,
          'precheck',
        );
        if (!precheckResult.ok) {
          return precheckResult;
        }

        const executeResult = await this.runExecuteSteps(driver, operation.execute, operation);
        if (!executeResult.ok) {
          return executeResult;
        }

        const postcheckResult = await this.runExpectationSteps(
          driver,
          operation.postcheck,
          operation,
          'postcheck',
        );
        if (!postcheckResult.ok) {
          return postcheckResult;
        }

        executedOperations.push(operation);
        operationsExecuted += 1;
      } finally {
        options.callbacks?.onOperationComplete?.(operation);
      }
    }
    return ok({ operationsExecuted, executedOperations });
  }

  private async ensureControlTables(
    driver: MigrationRunnerExecuteOptions<PostgresPlanTargetDetails>['driver'],
  ): Promise<void> {
    await this.executeStatement(driver, ensurePrismaContractSchemaStatement);
    await this.executeStatement(driver, ensureMarkerTableStatement);
    await this.executeStatement(driver, ensureLedgerTableStatement);
  }

  private async runExpectationSteps(
    driver: MigrationRunnerExecuteOptions<PostgresPlanTargetDetails>['driver'],
    steps: readonly MigrationPlanOperationStep[],
    operation: MigrationPlanOperation<PostgresPlanTargetDetails>,
    phase: 'precheck' | 'postcheck',
  ): Promise<Result<void, MigrationRunnerFailure>> {
    for (const step of steps) {
      const result = await driver.query(step.sql);
      if (!this.stepResultIsTrue(result.rows)) {
        const code = phase === 'precheck' ? 'PRECHECK_FAILED' : 'POSTCHECK_FAILED';
        return runnerFailure(
          code,
          `Operation ${operation.id} failed during ${phase}: ${step.description}`,
          {
            meta: {
              operationId: operation.id,
              phase,
              stepDescription: step.description,
            },
          },
        );
      }
    }
    return okVoid();
  }

  private async runExecuteSteps(
    driver: MigrationRunnerExecuteOptions<PostgresPlanTargetDetails>['driver'],
    steps: readonly MigrationPlanOperationStep[],
    operation: MigrationPlanOperation<PostgresPlanTargetDetails>,
  ): Promise<Result<void, MigrationRunnerFailure>> {
    for (const step of steps) {
      try {
        await driver.query(step.sql);
      } catch (error) {
        return runnerFailure(
          'EXECUTION_FAILED',
          `Operation ${operation.id} failed during execution: ${step.description}`,
          {
            why: error instanceof Error ? error.message : String(error),
            meta: {
              operationId: operation.id,
              stepDescription: step.description,
              sql: step.sql,
            },
          },
        );
      }
    }
    return okVoid();
  }

  private stepResultIsTrue(rows: readonly Record<string, unknown>[]): boolean {
    if (!rows || rows.length === 0) {
      return false;
    }
    const firstRow = rows[0];
    const firstValue = firstRow ? Object.values(firstRow)[0] : undefined;
    if (typeof firstValue === 'boolean') {
      return firstValue;
    }
    if (typeof firstValue === 'number') {
      return firstValue !== 0;
    }
    if (typeof firstValue === 'string') {
      const lower = firstValue.toLowerCase();
      // PostgreSQL boolean representations: 't'/'f', 'true'/'false', '1'/'0'
      if (lower === 't' || lower === 'true' || lower === '1') {
        return true;
      }
      if (lower === 'f' || lower === 'false' || lower === '0') {
        return false;
      }
      // For other strings, non-empty is truthy (though this case shouldn't occur for boolean checks)
      return firstValue.length > 0;
    }
    return Boolean(firstValue);
  }

  private async expectationsAreSatisfied(
    driver: MigrationRunnerExecuteOptions<PostgresPlanTargetDetails>['driver'],
    steps: readonly MigrationPlanOperationStep[],
  ): Promise<boolean> {
    if (steps.length === 0) {
      return false;
    }
    for (const step of steps) {
      const result = await driver.query(step.sql);
      if (!this.stepResultIsTrue(result.rows)) {
        return false;
      }
    }
    return true;
  }

  private createPostcheckPreSatisfiedSkipRecord(
    operation: MigrationPlanOperation<PostgresPlanTargetDetails>,
  ): MigrationPlanOperation<PostgresPlanTargetDetails> {
    // Clone and freeze existing meta if present
    const clonedMeta = operation.meta ? cloneAndFreezeRecord(operation.meta) : undefined;

    // Create frozen runner metadata
    const runnerMeta = Object.freeze({
      skipped: true,
      reason: 'postcheck_pre_satisfied',
    });

    // Merge and freeze the combined meta
    const mergedMeta = Object.freeze({
      ...(clonedMeta ?? {}),
      runner: runnerMeta,
    });

    // Clone and freeze arrays to prevent mutation
    const frozenPostcheck = Object.freeze([...operation.postcheck]);

    return Object.freeze({
      id: operation.id,
      label: operation.label,
      ...(operation.summary ? { summary: operation.summary } : {}),
      operationClass: operation.operationClass,
      target: operation.target, // Already frozen from plan creation
      precheck: Object.freeze([]),
      execute: Object.freeze([]),
      postcheck: frozenPostcheck,
      ...(operation.meta || mergedMeta ? { meta: mergedMeta } : {}),
    });
  }

  private markerMatchesDestination(
    marker: ContractMarkerRecord | null,
    plan: MigrationRunnerExecuteOptions<PostgresPlanTargetDetails>['plan'],
  ): boolean {
    if (!marker) {
      return false;
    }
    if (marker.coreHash !== plan.destination.coreHash) {
      return false;
    }
    if (plan.destination.profileHash && marker.profileHash !== plan.destination.profileHash) {
      return false;
    }
    return true;
  }

  private enforcePolicyCompatibility(
    policy: MigrationOperationPolicy,
    operations: readonly MigrationPlanOperation<PostgresPlanTargetDetails>[],
  ): Result<void, MigrationRunnerFailure> {
    const allowedClasses = new Set(policy.allowedOperationClasses);
    for (const operation of operations) {
      if (!allowedClasses.has(operation.operationClass)) {
        return runnerFailure(
          'POLICY_VIOLATION',
          `Operation ${operation.id} has class "${operation.operationClass}" which is not allowed by policy.`,
          {
            why: `Policy only allows: ${policy.allowedOperationClasses.join(', ')}.`,
            meta: {
              operationId: operation.id,
              operationClass: operation.operationClass,
              allowedClasses: policy.allowedOperationClasses,
            },
          },
        );
      }
    }
    return okVoid();
  }

  private ensureMarkerCompatibility(
    marker: ContractMarkerRecord | null,
    plan: MigrationRunnerExecuteOptions<PostgresPlanTargetDetails>['plan'],
  ): Result<void, MigrationRunnerFailure> {
    const origin = plan.origin ?? null;
    if (!origin) {
      if (!marker) {
        return okVoid();
      }
      if (this.markerMatchesDestination(marker, plan)) {
        return okVoid();
      }
      return runnerFailure(
        'MARKER_ORIGIN_MISMATCH',
        `Existing contract marker (${marker.coreHash}) does not match plan origin (no marker expected).`,
        {
          meta: {
            markerCoreHash: marker.coreHash,
            expectedOrigin: null,
          },
        },
      );
    }

    if (!marker) {
      return runnerFailure(
        'MARKER_ORIGIN_MISMATCH',
        `Missing contract marker: expected origin core hash ${origin.coreHash}.`,
        {
          meta: {
            expectedOriginCoreHash: origin.coreHash,
          },
        },
      );
    }
    if (marker.coreHash !== origin.coreHash) {
      return runnerFailure(
        'MARKER_ORIGIN_MISMATCH',
        `Existing contract marker (${marker.coreHash}) does not match plan origin (${origin.coreHash}).`,
        {
          meta: {
            markerCoreHash: marker.coreHash,
            expectedOriginCoreHash: origin.coreHash,
          },
        },
      );
    }
    if (origin.profileHash && marker.profileHash !== origin.profileHash) {
      return runnerFailure(
        'MARKER_ORIGIN_MISMATCH',
        `Existing contract marker profile hash (${marker.profileHash}) does not match plan origin profile hash (${origin.profileHash}).`,
        {
          meta: {
            markerProfileHash: marker.profileHash,
            expectedOriginProfileHash: origin.profileHash,
          },
        },
      );
    }
    return okVoid();
  }

  private ensurePlanMatchesDestinationContract(
    destination: MigrationPlanContractInfo,
    contract: MigrationRunnerExecuteOptions<PostgresPlanTargetDetails>['destinationContract'],
  ): Result<void, MigrationRunnerFailure> {
    if (destination.coreHash !== contract.coreHash) {
      return runnerFailure(
        'DESTINATION_CONTRACT_MISMATCH',
        `Plan destination core hash (${destination.coreHash}) does not match provided contract core hash (${contract.coreHash}).`,
        {
          meta: {
            planCoreHash: destination.coreHash,
            contractCoreHash: contract.coreHash,
          },
        },
      );
    }
    if (
      destination.profileHash &&
      contract.profileHash &&
      destination.profileHash !== contract.profileHash
    ) {
      return runnerFailure(
        'DESTINATION_CONTRACT_MISMATCH',
        `Plan destination profile hash (${destination.profileHash}) does not match provided contract profile hash (${contract.profileHash}).`,
        {
          meta: {
            planProfileHash: destination.profileHash,
            contractProfileHash: contract.profileHash,
          },
        },
      );
    }
    return okVoid();
  }

  private async upsertMarker(
    driver: MigrationRunnerExecuteOptions<PostgresPlanTargetDetails>['driver'],
    options: MigrationRunnerExecuteOptions<PostgresPlanTargetDetails>,
    existingMarker: ContractMarkerRecord | null,
  ): Promise<void> {
    const writeStatements = buildWriteMarkerStatements({
      coreHash: options.plan.destination.coreHash,
      profileHash:
        options.plan.destination.profileHash ??
        options.destinationContract.profileHash ??
        options.plan.destination.coreHash,
      contractJson: options.destinationContract,
      canonicalVersion: null,
      meta: {},
    });
    const statement = existingMarker ? writeStatements.update : writeStatements.insert;
    await this.executeStatement(driver, statement);
  }

  private async recordLedgerEntry(
    driver: MigrationRunnerExecuteOptions<PostgresPlanTargetDetails>['driver'],
    options: MigrationRunnerExecuteOptions<PostgresPlanTargetDetails>,
    existingMarker: ContractMarkerRecord | null,
    executedOperations: readonly MigrationPlanOperation<PostgresPlanTargetDetails>[],
  ): Promise<void> {
    const ledgerStatement = buildLedgerInsertStatement({
      originCoreHash: existingMarker?.coreHash ?? null,
      originProfileHash: existingMarker?.profileHash ?? null,
      destinationCoreHash: options.plan.destination.coreHash,
      destinationProfileHash:
        options.plan.destination.profileHash ??
        options.destinationContract.profileHash ??
        options.plan.destination.coreHash,
      contractJsonBefore: existingMarker?.contractJson ?? null,
      contractJsonAfter: options.destinationContract,
      operations: executedOperations,
    });
    await this.executeStatement(driver, ledgerStatement);
  }

  private async acquireLock(
    driver: MigrationRunnerExecuteOptions<PostgresPlanTargetDetails>['driver'],
    key: string,
  ): Promise<void> {
    await driver.query('select pg_advisory_xact_lock(hashtext($1))', [key]);
  }

  private async beginTransaction(
    driver: MigrationRunnerExecuteOptions<PostgresPlanTargetDetails>['driver'],
  ): Promise<void> {
    await driver.query('BEGIN');
  }

  private async commitTransaction(
    driver: MigrationRunnerExecuteOptions<PostgresPlanTargetDetails>['driver'],
  ): Promise<void> {
    await driver.query('COMMIT');
  }

  private async rollbackTransaction(
    driver: MigrationRunnerExecuteOptions<PostgresPlanTargetDetails>['driver'],
  ): Promise<void> {
    await driver.query('ROLLBACK');
  }

  private async executeStatement(
    driver: MigrationRunnerExecuteOptions<PostgresPlanTargetDetails>['driver'],
    statement: SqlStatement,
  ): Promise<void> {
    if (statement.params.length > 0) {
      await driver.query(statement.sql, statement.params);
      return;
    }
    await driver.query(statement.sql);
  }
}
