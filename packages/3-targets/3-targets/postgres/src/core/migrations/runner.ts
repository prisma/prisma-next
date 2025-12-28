import type { ContractMarkerRecord } from '@prisma-next/contract/types';
import type {
  MigrationPlanContractInfo,
  MigrationPlanOperation,
  MigrationPlanOperationStep,
  MigrationRunner,
  MigrationRunnerExecuteOptions,
  MigrationRunnerResult,
  SchemaVerifyOptions,
  SqlControlFamilyInstance,
} from '@prisma-next/family-sql/control';
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

const DEFAULT_CONFIG: RunnerConfig = {
  defaultSchema: 'public',
};

const LOCK_DOMAIN = 'prisma_next.contract.marker';

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
    await this.beginTransaction(driver);
    try {
      await this.acquireLock(driver, lockKey);
      await this.ensureControlTables(driver);
      const existingMarker = await readMarker(driver);
      this.ensureMarkerCompatibility(existingMarker, options.plan.contract);

      const markerAtDestination = this.markerMatchesDestination(
        existingMarker,
        options.plan.contract,
      );
      const { operationsExecuted, executedOperations } = markerAtDestination
        ? { operationsExecuted: 0, executedOperations: [] as const }
        : await this.applyPlan(driver, options);

      const schemaVerifyOptions: SchemaVerifyOptions = {
        driver,
        contractIR: options.contract,
        strict: options.strictVerification ?? true,
        context: options.context ?? {},
      };
      const schemaVerifyResult = await this.family.schemaVerify(schemaVerifyOptions);
      if (!schemaVerifyResult.ok) {
        throw new Error(schemaVerifyResult.summary);
      }

      await this.upsertMarker(driver, options, existingMarker);
      await this.recordLedgerEntry(driver, options, existingMarker, executedOperations);

      await this.commitTransaction(driver);
      await this.releaseLock(driver, lockKey);
      return {
        operationsPlanned: options.plan.operations.length,
        operationsExecuted,
      };
    } catch (error) {
      await this.rollbackTransaction(driver);
      await this.releaseLock(driver, lockKey).catch(() => {
        // ignore unlock errors during rollback
      });
      throw error;
    }
  }

  private async applyPlan(
    driver: MigrationRunnerExecuteOptions<PostgresPlanTargetDetails>['driver'],
    options: MigrationRunnerExecuteOptions<PostgresPlanTargetDetails>,
  ): Promise<{
    readonly operationsExecuted: number;
    readonly executedOperations: readonly MigrationPlanOperation<PostgresPlanTargetDetails>[];
  }> {
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

        await this.runExpectationSteps(driver, operation.precheck, operation, 'precheck');
        await this.runExecuteSteps(driver, operation.execute);
        await this.runExpectationSteps(driver, operation.postcheck, operation, 'postcheck');

        executedOperations.push(operation);
        operationsExecuted += 1;
      } finally {
        options.callbacks?.onOperationComplete?.(operation);
      }
    }
    return { operationsExecuted, executedOperations };
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
  ): Promise<void> {
    for (const step of steps) {
      const result = await driver.query(step.sql);
      if (!this.stepResultIsTrue(result.rows)) {
        throw new RunnerStepError(operation.id, phase, step.description);
      }
    }
  }

  private async runExecuteSteps(
    driver: MigrationRunnerExecuteOptions<PostgresPlanTargetDetails>['driver'],
    steps: readonly MigrationPlanOperationStep[],
  ): Promise<void> {
    for (const step of steps) {
      await driver.query(step.sql);
    }
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
      return firstValue === 't' || firstValue.toLowerCase() === 'true';
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
    return {
      ...operation,
      precheck: [],
      execute: [],
      postcheck: operation.postcheck,
      meta: {
        ...(operation.meta ?? {}),
        runner: {
          skipped: true,
          reason: 'postcheck_pre_satisfied',
        },
      },
    };
  }

  private markerMatchesDestination(
    marker: ContractMarkerRecord | null,
    destination: MigrationPlanContractInfo,
  ): boolean {
    if (!marker) {
      return false;
    }
    if (marker.coreHash !== destination.coreHash) {
      return false;
    }
    if (destination.profileHash && marker.profileHash !== destination.profileHash) {
      return false;
    }
    return true;
  }

  private ensureMarkerCompatibility(
    marker: ContractMarkerRecord | null,
    destination: MigrationPlanContractInfo,
  ): void {
    if (!marker) {
      return;
    }
    if (marker.coreHash !== destination.coreHash) {
      throw new Error(
        `Existing contract marker (${marker.coreHash}) does not match planned contract (${destination.coreHash}).`,
      );
    }
    if (destination.profileHash && marker.profileHash !== destination.profileHash) {
      throw new Error(
        `Existing contract marker profile hash (${marker.profileHash}) does not match planned contract profile hash (${destination.profileHash}).`,
      );
    }
  }

  private async upsertMarker(
    driver: MigrationRunnerExecuteOptions<PostgresPlanTargetDetails>['driver'],
    options: MigrationRunnerExecuteOptions<PostgresPlanTargetDetails>,
    existingMarker: ContractMarkerRecord | null,
  ): Promise<void> {
    const writeStatements = buildWriteMarkerStatements({
      coreHash: options.plan.contract.coreHash,
      profileHash:
        options.plan.contract.profileHash ??
        options.contract.profileHash ??
        options.plan.contract.coreHash,
      contractJson: options.contract,
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
      destinationCoreHash: options.plan.contract.coreHash,
      destinationProfileHash:
        options.plan.contract.profileHash ??
        options.contract.profileHash ??
        options.plan.contract.coreHash,
      contractJsonBefore: existingMarker?.contractJson ?? null,
      contractJsonAfter: options.contract,
      operations: executedOperations,
    });
    await this.executeStatement(driver, ledgerStatement);
  }

  private async acquireLock(
    driver: MigrationRunnerExecuteOptions<PostgresPlanTargetDetails>['driver'],
    key: string,
  ): Promise<void> {
    await driver.query('select pg_advisory_lock(hashtext($1))', [key]);
  }

  private async releaseLock(
    driver: MigrationRunnerExecuteOptions<PostgresPlanTargetDetails>['driver'],
    key: string,
  ): Promise<void> {
    await driver.query('select pg_advisory_unlock(hashtext($1))', [key]);
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

class RunnerStepError extends Error {
  constructor(operationId: string, phase: 'precheck' | 'postcheck', description: string) {
    super(`Operation ${operationId} failed during ${phase}: ${description}`);
    this.name = 'RunnerStepError';
  }
}
