import { parseSqliteDefault } from '@prisma-next/adapter-sqlite/control';
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
import type { SqlitePlanTargetDetails } from './planner';
import {
  buildLedgerInsertStatement,
  buildWriteMarkerStatements,
  ensureLedgerTableStatement,
  ensureMarkerTableStatement,
  type SqlStatement,
} from './statement-builders';

interface ApplyPlanSuccessValue {
  readonly operationsExecuted: number;
  readonly executedOperations: readonly SqlMigrationPlanOperation<SqlitePlanTargetDetails>[];
}

export function createSqliteMigrationRunner(
  family: SqlControlFamilyInstance,
): SqlMigrationRunner<SqlitePlanTargetDetails> {
  return new SqliteMigrationRunner(family);
}

class SqliteMigrationRunner implements SqlMigrationRunner<SqlitePlanTargetDetails> {
  constructor(private readonly family: SqlControlFamilyInstance) {}

  async execute(
    options: SqlMigrationRunnerExecuteOptions<SqlitePlanTargetDetails>,
  ): Promise<SqlMigrationRunnerResult> {
    const driver = options.driver;

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

    await this.beginTransaction(driver);
    let committed = false;

    try {
      await this.ensureControlTables(driver);
      const existingMarker = await readMarker(driver);

      const markerCheck = this.ensureMarkerCompatibility(existingMarker, options.plan);
      if (!markerCheck.ok) {
        return markerCheck;
      }

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
      const schemaIR = await this.family.introspect({
        driver,
        contractIR: options.destinationContract,
      });

      const schemaVerifyResult = verifySqlSchema({
        contract: options.destinationContract,
        schema: schemaIR,
        strict: options.strictVerification ?? true,
        context: options.context ?? {},
        typeMetadataRegistry: this.family.typeMetadataRegistry,
        frameworkComponents: options.frameworkComponents,
        normalizeDefault: parseSqliteDefault,
      });
      if (!schemaVerifyResult.ok) {
        return runnerFailure('SCHEMA_VERIFY_FAILED', schemaVerifyResult.summary, {
          why: 'The resulting database schema does not satisfy the destination contract.',
          meta: {
            issues: schemaVerifyResult.schema.issues,
          },
        });
      }

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
    driver: SqlMigrationRunnerExecuteOptions<SqlitePlanTargetDetails>['driver'],
    options: SqlMigrationRunnerExecuteOptions<SqlitePlanTargetDetails>,
  ): Promise<Result<ApplyPlanSuccessValue, SqlMigrationRunnerFailure>> {
    const checks = options.executionChecks;
    const runPrechecks = checks?.prechecks !== false;
    const runPostchecks = checks?.postchecks !== false;
    const runIdempotency = checks?.idempotencyChecks !== false;

    let operationsExecuted = 0;
    const executedOperations: Array<SqlMigrationPlanOperation<SqlitePlanTargetDetails>> = [];

    for (const operation of options.plan.operations) {
      options.callbacks?.onOperationStart?.(operation);
      try {
        if (runPostchecks && runIdempotency) {
          const postcheckAlreadySatisfied = await this.expectationsAreSatisfied(
            driver,
            operation.postcheck,
          );
          if (postcheckAlreadySatisfied) {
            executedOperations.push(operation);
            continue;
          }
        }

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
    driver: SqlMigrationRunnerExecuteOptions<SqlitePlanTargetDetails>['driver'],
  ): Promise<void> {
    await this.executeStatement(driver, ensureMarkerTableStatement);
    await this.executeStatement(driver, ensureLedgerTableStatement);
  }

  private async runExpectationSteps(
    driver: SqlMigrationRunnerExecuteOptions<SqlitePlanTargetDetails>['driver'],
    steps: readonly SqlMigrationPlanOperationStep[],
    operation: SqlMigrationPlanOperation<SqlitePlanTargetDetails>,
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
    driver: SqlMigrationRunnerExecuteOptions<SqlitePlanTargetDetails>['driver'],
    steps: readonly SqlMigrationPlanOperationStep[],
    operation: SqlMigrationPlanOperation<SqlitePlanTargetDetails>,
  ): Promise<Result<void, SqlMigrationRunnerFailure>> {
    for (const step of steps) {
      try {
        await driver.query(step.sql);
      } catch (error: unknown) {
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
      if (lower === 'true' || lower === '1') {
        return true;
      }
      if (lower === 'false' || lower === '0') {
        return false;
      }
      return firstValue.length > 0;
    }
    return Boolean(firstValue);
  }

  private async expectationsAreSatisfied(
    driver: SqlMigrationRunnerExecuteOptions<SqlitePlanTargetDetails>['driver'],
    steps: readonly SqlMigrationPlanOperationStep[],
  ): Promise<boolean> {
    for (const step of steps) {
      try {
        const result = await driver.query(step.sql);
        if (!this.stepResultIsTrue(result.rows)) {
          return false;
        }
      } catch {
        return false;
      }
    }
    return true;
  }

  private ensurePlanMatchesDestinationContract(
    destination: SqlMigrationPlanContractInfo,
    contract: SqlMigrationRunnerExecuteOptions<SqlitePlanTargetDetails>['destinationContract'],
  ): Result<void, SqlMigrationRunnerFailure> {
    if (destination.coreHash !== contract.coreHash) {
      return runnerFailure(
        'DESTINATION_CONTRACT_MISMATCH',
        'Plan destination does not match destination contract core hash',
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
        'Plan destination does not match destination contract profile hash',
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

  private enforcePolicyCompatibility(
    policy: MigrationOperationPolicy,
    operations: readonly SqlMigrationPlanOperation<SqlitePlanTargetDetails>[],
  ): Result<void, SqlMigrationRunnerFailure> {
    for (const op of operations) {
      if (!policy.allowedOperationClasses.includes(op.operationClass)) {
        return runnerFailure('POLICY_VIOLATION', 'Operation class not allowed by policy', {
          meta: { operationId: op.id, operationClass: op.operationClass },
        });
      }
    }
    return okVoid();
  }

  private ensureMarkerCompatibility(
    marker: ContractMarkerRecord | null,
    plan: SqlMigrationRunnerExecuteOptions<SqlitePlanTargetDetails>['plan'],
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

  private markerMatchesDestination(
    existingMarker: ContractMarkerRecord | null,
    plan: { readonly destination: { readonly coreHash: string; readonly profileHash?: string } },
  ): boolean {
    if (!existingMarker) {
      return false;
    }
    if (existingMarker.coreHash !== plan.destination.coreHash) {
      return false;
    }
    if (
      plan.destination.profileHash &&
      existingMarker.profileHash !== plan.destination.profileHash
    ) {
      return false;
    }
    return true;
  }

  private async upsertMarker(
    driver: SqlMigrationRunnerExecuteOptions<SqlitePlanTargetDetails>['driver'],
    options: SqlMigrationRunnerExecuteOptions<SqlitePlanTargetDetails>,
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
    driver: SqlMigrationRunnerExecuteOptions<SqlitePlanTargetDetails>['driver'],
    options: SqlMigrationRunnerExecuteOptions<SqlitePlanTargetDetails>,
    existingMarker: ContractMarkerRecord | null,
    executedOperations: readonly SqlMigrationPlanOperation<SqlitePlanTargetDetails>[],
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

  private async beginTransaction(
    driver: SqlMigrationRunnerExecuteOptions<SqlitePlanTargetDetails>['driver'],
  ): Promise<void> {
    await driver.query('BEGIN IMMEDIATE');
  }

  private async commitTransaction(
    driver: SqlMigrationRunnerExecuteOptions<SqlitePlanTargetDetails>['driver'],
  ): Promise<void> {
    await driver.query('COMMIT');
  }

  private async rollbackTransaction(
    driver: SqlMigrationRunnerExecuteOptions<SqlitePlanTargetDetails>['driver'],
  ): Promise<void> {
    await driver.query('ROLLBACK');
  }

  private async executeStatement(
    driver: SqlMigrationRunnerExecuteOptions<SqlitePlanTargetDetails>['driver'],
    statement: SqlStatement,
  ): Promise<void> {
    if (statement.params.length > 0) {
      await driver.query(statement.sql, statement.params);
      return;
    }
    await driver.query(statement.sql);
  }
}
