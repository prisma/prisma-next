import { normalizeSqliteNativeType, parseSqliteDefault } from '@prisma-next/adapter-sqlite/control';
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
import { ifDefined } from '@prisma-next/utils/defined';
import type { Result } from '@prisma-next/utils/result';
import { ok, okVoid } from '@prisma-next/utils/result';
import type { SqlitePlanTargetDetails } from './planner-target-details';
import {
  buildLedgerInsertStatement,
  buildWriteMarkerStatements,
  ensureLedgerTableStatement,
  ensureMarkerTableStatement,
  readMarkerStatement,
  type SqlStatement,
} from './statement-builders';

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

    // SQLite recreate-table drops and rebuilds the table. If foreign_keys is ON,
    // dropping a referenced parent cascade-deletes child rows; we must disable FK
    // enforcement for the duration of the migration and validate integrity before
    // committing. PRAGMA foreign_keys is a no-op inside a transaction, so toggle
    // around BEGIN/COMMIT.
    const fkWasEnabled = await this.readForeignKeysEnabled(driver);
    if (fkWasEnabled) {
      await driver.query('PRAGMA foreign_keys = OFF');
    }

    try {
      await this.beginExclusiveTransaction(driver);
      let committed = false;
      try {
        await this.ensureControlTables(driver);
        const existingMarker = await this.readMarker(driver);

        const markerCheck = this.ensureMarkerCompatibility(existingMarker, options.plan);
        if (!markerCheck.ok) {
          return markerCheck;
        }

        const markerAtDestination = this.markerMatchesDestination(existingMarker, options.plan);
        const skipOperations = markerAtDestination && options.plan.origin != null;

        let operationsExecuted: number;
        let executedOperations: readonly SqlMigrationPlanOperation<SqlitePlanTargetDetails>[];

        if (skipOperations) {
          operationsExecuted = 0;
          executedOperations = [];
        } else {
          const applyResult = await this.applyPlan(driver, options);
          if (!applyResult.ok) {
            return applyResult;
          }
          operationsExecuted = applyResult.value.operationsExecuted;
          executedOperations = applyResult.value.executedOperations;
        }

        // Verify resulting schema matches contract
        const schemaIR = await this.family.introspect({
          driver,
          contract: options.destinationContract,
        });

        const schemaVerifyResult = verifySqlSchema({
          contract: options.destinationContract,
          schema: schemaIR,
          strict: options.strictVerification ?? true,
          context: options.context ?? {},
          typeMetadataRegistry: this.family.typeMetadataRegistry,
          frameworkComponents: options.frameworkComponents,
          normalizeDefault: parseSqliteDefault,
          normalizeNativeType: normalizeSqliteNativeType,
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
        await this.recordLedgerEntry(driver, options, existingMarker, executedOperations);

        if (fkWasEnabled) {
          const fkIntegrityCheck = await this.verifyForeignKeyIntegrity(driver);
          if (!fkIntegrityCheck.ok) {
            return fkIntegrityCheck;
          }
        }

        await this.commitTransaction(driver);
        committed = true;
        return runnerSuccess({
          operationsPlanned: options.plan.operations.length,
          operationsExecuted,
        });
      } finally {
        if (!committed) {
          await this.rollbackTransaction(driver);
        }
      }
    } finally {
      if (fkWasEnabled) {
        await driver.query('PRAGMA foreign_keys = ON');
      }
    }
  }

  private async readForeignKeysEnabled(
    driver: SqlMigrationRunnerExecuteOptions<SqlitePlanTargetDetails>['driver'],
  ): Promise<boolean> {
    const result = await driver.query<{ foreign_keys: number }>('PRAGMA foreign_keys');
    const row = result.rows[0];
    return row?.foreign_keys === 1;
  }

  private async verifyForeignKeyIntegrity(
    driver: SqlMigrationRunnerExecuteOptions<SqlitePlanTargetDetails>['driver'],
  ): Promise<Result<void, SqlMigrationRunnerFailure>> {
    const result = await driver.query<Record<string, unknown>>('PRAGMA foreign_key_check');
    if (result.rows.length === 0) {
      return okVoid();
    }
    return runnerFailure(
      'FOREIGN_KEY_VIOLATION',
      `Foreign key integrity check failed after migration: ${result.rows.length} violation(s).`,
      {
        why: 'PRAGMA foreign_key_check reported violations after applying recreate-table operations.',
        meta: { violations: result.rows },
      },
    );
  }

  private async applyPlan(
    driver: SqlMigrationRunnerExecuteOptions<SqlitePlanTargetDetails>['driver'],
    options: SqlMigrationRunnerExecuteOptions<SqlitePlanTargetDetails>,
  ): Promise<
    Result<
      {
        readonly operationsExecuted: number;
        readonly executedOperations: readonly SqlMigrationPlanOperation<SqlitePlanTargetDetails>[];
      },
      SqlMigrationRunnerFailure
    >
  > {
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
            executedOperations.push(this.createSkipRecord(operation));
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

  private async readMarker(
    driver: SqlMigrationRunnerExecuteOptions<SqlitePlanTargetDetails>['driver'],
  ): Promise<ContractMarkerRecord | null> {
    const stmt = readMarkerStatement();
    try {
      const result = await driver.query<{
        core_hash: string;
        profile_hash: string;
        contract_json: string | null;
        canonical_version: number | null;
        updated_at: string;
        app_tag: string | null;
        meta: string | null;
      }>(stmt.sql, stmt.params);

      if (result.rows.length === 0) {
        return null;
      }
      const row = result.rows[0];
      if (!row) {
        return null;
      }
      return {
        storageHash: row.core_hash,
        profileHash: row.profile_hash,
        contractJson: row.contract_json ? safeJsonParse(row.contract_json) : null,
        canonicalVersion: row.canonical_version,
        updatedAt: new Date(row.updated_at),
        appTag: row.app_tag,
        meta: row.meta ? (safeJsonParse(row.meta) as Record<string, unknown>) : {},
      };
    } catch (error) {
      // Table might not exist yet
      if (error instanceof Error && error.message.includes('no such table')) {
        return null;
      }
      throw error;
    }
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
        const message = error instanceof Error ? error.message : String(error);
        return runnerFailure(
          'EXECUTION_FAILED',
          `Operation ${operation.id} failed during execution: ${step.description}`,
          {
            why: message,
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
    if (typeof firstValue === 'number') {
      return firstValue !== 0;
    }
    if (typeof firstValue === 'boolean') {
      return firstValue;
    }
    if (typeof firstValue === 'string') {
      const lower = firstValue.toLowerCase();
      if (lower === 'true' || lower === '1') return true;
      if (lower === 'false' || lower === '0') return false;
      return firstValue.length > 0;
    }
    return Boolean(firstValue);
  }

  private async expectationsAreSatisfied(
    driver: SqlMigrationRunnerExecuteOptions<SqlitePlanTargetDetails>['driver'],
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

  private createSkipRecord(
    operation: SqlMigrationPlanOperation<SqlitePlanTargetDetails>,
  ): SqlMigrationPlanOperation<SqlitePlanTargetDetails> {
    return Object.freeze({
      id: operation.id,
      label: operation.label,
      ...ifDefined('summary', operation.summary),
      operationClass: operation.operationClass,
      target: operation.target,
      precheck: Object.freeze([]),
      execute: Object.freeze([]),
      postcheck: Object.freeze([...operation.postcheck]),
      meta: Object.freeze({
        ...(operation.meta ?? {}),
        runner: Object.freeze({ skipped: true, reason: 'postcheck_pre_satisfied' }),
      }),
    });
  }

  private markerMatchesDestination(
    marker: ContractMarkerRecord | null,
    plan: SqlMigrationRunnerExecuteOptions<SqlitePlanTargetDetails>['plan'],
  ): boolean {
    if (!marker) return false;
    if (marker.storageHash !== plan.destination.storageHash) return false;
    if (plan.destination.profileHash && marker.profileHash !== plan.destination.profileHash) {
      return false;
    }
    return true;
  }

  private enforcePolicyCompatibility(
    policy: MigrationOperationPolicy,
    operations: readonly SqlMigrationPlanOperation<SqlitePlanTargetDetails>[],
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
    plan: SqlMigrationRunnerExecuteOptions<SqlitePlanTargetDetails>['plan'],
  ): Result<void, SqlMigrationRunnerFailure> {
    const origin = plan.origin ?? null;
    if (!origin) {
      return okVoid();
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
    contract: SqlMigrationRunnerExecuteOptions<SqlitePlanTargetDetails>['destinationContract'],
  ): Result<void, SqlMigrationRunnerFailure> {
    if (destination.storageHash !== contract.storage.storageHash) {
      return runnerFailure(
        'DESTINATION_CONTRACT_MISMATCH',
        `Plan destination storage hash (${destination.storageHash}) does not match provided contract storage hash (${contract.storage.storageHash}).`,
        {
          meta: {
            planStorageHash: destination.storageHash,
            contractStorageHash: contract.storage.storageHash,
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
    driver: SqlMigrationRunnerExecuteOptions<SqlitePlanTargetDetails>['driver'],
    options: SqlMigrationRunnerExecuteOptions<SqlitePlanTargetDetails>,
    existingMarker: ContractMarkerRecord | null,
  ): Promise<void> {
    const writeStatements = buildWriteMarkerStatements({
      storageHash: options.plan.destination.storageHash,
      profileHash:
        options.plan.destination.profileHash ??
        options.destinationContract.profileHash ??
        options.plan.destination.storageHash,
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
      originStorageHash: existingMarker?.storageHash ?? null,
      originProfileHash: existingMarker?.profileHash ?? null,
      destinationStorageHash: options.plan.destination.storageHash,
      destinationProfileHash:
        options.plan.destination.profileHash ??
        options.destinationContract.profileHash ??
        options.plan.destination.storageHash,
      contractJsonBefore: existingMarker?.contractJson ?? null,
      contractJsonAfter: options.destinationContract,
      operations: executedOperations,
    });
    await this.executeStatement(driver, ledgerStatement);
  }

  private async beginExclusiveTransaction(
    driver: SqlMigrationRunnerExecuteOptions<SqlitePlanTargetDetails>['driver'],
  ): Promise<void> {
    await driver.query('BEGIN EXCLUSIVE');
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

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
