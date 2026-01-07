import type { ContractMarkerRecord } from '@prisma-next/contract/types';
import type {
  MigrationOperationPolicy,
  SqlControlFamilyInstance,
  SqlMigrationPlanContractInfo,
  SqlMigrationPlanOperation,
  SqlMigrationPlanOperationStep,
  SqlMigrationRunner,
  SqlMigrationRunnerExecuteOptions,
  SqlMigrationRunnerFailure,
  SqlMigrationRunnerResult,
} from '@prisma-next/family-sql/control';
import { runnerFailure, runnerSuccess } from '@prisma-next/family-sql/control';
import { verifySqlSchema } from '@prisma-next/family-sql/schema-verify';
import { readMarker } from '@prisma-next/family-sql/verify';
import { SqlQueryError } from '@prisma-next/sql-errors';
import type { Result } from '@prisma-next/utils/result';
import { ok, okVoid } from '@prisma-next/utils/result';
import type { PostgresPlanTargetDetails } from './planner.ts';
import {
  buildLedgerInsertStatement,
  buildWriteMarkerStatements,
  ensureLedgerTableStatement,
  ensureMarkerTableStatement,
  ensurePrismaContractSchemaStatement,
  type SqlStatement,
} from './statement-builders.ts';

interface RunnerConfig {
  readonly defaultSchema: string;
}

interface ApplyPlanSuccessValue {
  readonly operationsExecuted: number;
  readonly executedOperations: readonly SqlMigrationPlanOperation<PostgresPlanTargetDetails>[];
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
): SqlMigrationRunner<PostgresPlanTargetDetails> {
  return new PostgresMigrationRunner(family, { ...DEFAULT_CONFIG, ...config });
}

class PostgresMigrationRunner implements SqlMigrationRunner<PostgresPlanTargetDetails> {
  constructor(
    private readonly family: SqlControlFamilyInstance,
    private readonly config: RunnerConfig,
  ) {}

  async execute(
    options: SqlMigrationRunnerExecuteOptions<PostgresPlanTargetDetails>,
  ): Promise<SqlMigrationRunnerResult> {
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
      // Step 1: Introspect live schema (DB I/O, family-owned)
      const schemaIR = await this.family.introspect({
        driver,
        contractIR: options.destinationContract,
      });

      // Step 2: Pure verification (no DB I/O)
      const schemaVerifyResult = verifySqlSchema({
        contract: options.destinationContract,
        schema: schemaIR,
        strict: options.strictVerification ?? true,
        context: options.context ?? {},
        typeMetadataRegistry: this.family.typeMetadataRegistry,
        frameworkComponents: options.frameworkComponents,
      });
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
    driver: SqlMigrationRunnerExecuteOptions<PostgresPlanTargetDetails>['driver'],
    options: SqlMigrationRunnerExecuteOptions<PostgresPlanTargetDetails>,
  ): Promise<Result<ApplyPlanSuccessValue, SqlMigrationRunnerFailure>> {
    const checks = options.executionChecks;
    const runPrechecks = checks?.prechecks !== false; // Default true
    const runPostchecks = checks?.postchecks !== false; // Default true
    const runIdempotency = checks?.idempotencyChecks !== false; // Default true

    let operationsExecuted = 0;
    const executedOperations: Array<SqlMigrationPlanOperation<PostgresPlanTargetDetails>> = [];
    for (const operation of options.plan.operations) {
      options.callbacks?.onOperationStart?.(operation);
      try {
        // Idempotency probe: only run if both postchecks and idempotency checks are enabled
        if (runPostchecks && runIdempotency) {
          const postcheckAlreadySatisfied = await this.expectationsAreSatisfied(
            driver,
            operation.postcheck,
          );
          if (postcheckAlreadySatisfied) {
            executedOperations.push(this.createPostcheckPreSatisfiedSkipRecord(operation));
            continue;
          }
        }

        // Prechecks: only run if enabled
        if (runPrechecks) {
          const precheckResult = await this.runExpectationSteps(
            driver,
            operation.precheck,
            operation,
            'precheck',
          );
          if (!precheckResult.ok) {
            return precheckResult;
          }
        }

        const executeResult = await this.runExecuteSteps(driver, operation.execute, operation);
        if (!executeResult.ok) {
          return executeResult;
        }

        // Postchecks: only run if enabled
        if (runPostchecks) {
          const postcheckResult = await this.runExpectationSteps(
            driver,
            operation.postcheck,
            operation,
            'postcheck',
          );
          if (!postcheckResult.ok) {
            return postcheckResult;
          }
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
    driver: SqlMigrationRunnerExecuteOptions<PostgresPlanTargetDetails>['driver'],
  ): Promise<void> {
    await this.executeStatement(driver, ensurePrismaContractSchemaStatement);
    await this.executeStatement(driver, ensureMarkerTableStatement);
    await this.executeStatement(driver, ensureLedgerTableStatement);
  }

  private async runExpectationSteps(
    driver: SqlMigrationRunnerExecuteOptions<PostgresPlanTargetDetails>['driver'],
    steps: readonly SqlMigrationPlanOperationStep[],
    operation: SqlMigrationPlanOperation<PostgresPlanTargetDetails>,
    phase: 'precheck' | 'postcheck',
  ): Promise<Result<void, SqlMigrationRunnerFailure>> {
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
    driver: SqlMigrationRunnerExecuteOptions<PostgresPlanTargetDetails>['driver'],
    steps: readonly SqlMigrationPlanOperationStep[],
    operation: SqlMigrationPlanOperation<PostgresPlanTargetDetails>,
  ): Promise<Result<void, SqlMigrationRunnerFailure>> {
    for (const step of steps) {
      try {
        await driver.query(step.sql);
      } catch (error: unknown) {
        // Catch SqlQueryError and include normalized metadata
        if (SqlQueryError.is(error)) {
          return runnerFailure(
            'EXECUTION_FAILED',
            `Operation ${operation.id} failed during execution: ${step.description}`,
            {
              why: error.message,
              meta: {
                operationId: operation.id,
                stepDescription: step.description,
                sql: step.sql,
                sqlState: error.sqlState,
                constraint: error.constraint,
                table: error.table,
                column: error.column,
                detail: error.detail,
              },
            },
          );
        }
        // Let SqlConnectionError and other errors propagate (fail-fast)
        throw error;
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
    driver: SqlMigrationRunnerExecuteOptions<PostgresPlanTargetDetails>['driver'],
    steps: readonly SqlMigrationPlanOperationStep[],
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
    operation: SqlMigrationPlanOperation<PostgresPlanTargetDetails>,
  ): SqlMigrationPlanOperation<PostgresPlanTargetDetails> {
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
    plan: SqlMigrationRunnerExecuteOptions<PostgresPlanTargetDetails>['plan'],
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
    operations: readonly SqlMigrationPlanOperation<PostgresPlanTargetDetails>[],
  ): Result<void, SqlMigrationRunnerFailure> {
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
    plan: SqlMigrationRunnerExecuteOptions<PostgresPlanTargetDetails>['plan'],
  ): Result<void, SqlMigrationRunnerFailure> {
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
    destination: SqlMigrationPlanContractInfo,
    contract: SqlMigrationRunnerExecuteOptions<PostgresPlanTargetDetails>['destinationContract'],
  ): Result<void, SqlMigrationRunnerFailure> {
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
    driver: SqlMigrationRunnerExecuteOptions<PostgresPlanTargetDetails>['driver'],
    options: SqlMigrationRunnerExecuteOptions<PostgresPlanTargetDetails>,
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
    driver: SqlMigrationRunnerExecuteOptions<PostgresPlanTargetDetails>['driver'],
    options: SqlMigrationRunnerExecuteOptions<PostgresPlanTargetDetails>,
    existingMarker: ContractMarkerRecord | null,
    executedOperations: readonly SqlMigrationPlanOperation<PostgresPlanTargetDetails>[],
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
    driver: SqlMigrationRunnerExecuteOptions<PostgresPlanTargetDetails>['driver'],
    key: string,
  ): Promise<void> {
    await driver.query('select pg_advisory_xact_lock(hashtext($1))', [key]);
  }

  private async beginTransaction(
    driver: SqlMigrationRunnerExecuteOptions<PostgresPlanTargetDetails>['driver'],
  ): Promise<void> {
    await driver.query('BEGIN');
  }

  private async commitTransaction(
    driver: SqlMigrationRunnerExecuteOptions<PostgresPlanTargetDetails>['driver'],
  ): Promise<void> {
    await driver.query('COMMIT');
  }

  private async rollbackTransaction(
    driver: SqlMigrationRunnerExecuteOptions<PostgresPlanTargetDetails>['driver'],
  ): Promise<void> {
    await driver.query('ROLLBACK');
  }

  private async executeStatement(
    driver: SqlMigrationRunnerExecuteOptions<PostgresPlanTargetDetails>['driver'],
    statement: SqlStatement,
  ): Promise<void> {
    if (statement.params.length > 0) {
      await driver.query(statement.sql, statement.params);
      return;
    }
    await driver.query(statement.sql);
  }
}
