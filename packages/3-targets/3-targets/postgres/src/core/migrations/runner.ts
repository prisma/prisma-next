import type { ContractMarkerRecord } from '@prisma-next/contract/types';
import type {
  MigrationPlan,
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

      // Validate plan destination matches provided contract
      const destinationMismatch = this.ensurePlanMatchesDestinationContract(
        options.plan.destination,
        options.destinationContract,
      );
      if (destinationMismatch) {
        await this.rollbackTransaction(driver);
        return destinationMismatch;
      }

      // Validate plan origin matches existing marker
      const markerMismatch = this.ensureMarkerCompatibility(existingMarker, options.plan);
      if (markerMismatch) {
        await this.rollbackTransaction(driver);
        return markerMismatch;
      }

      // Enforce policy compatibility
      const policyViolation = this.enforcePolicyCompatibility(options.plan);
      if (policyViolation) {
        await this.rollbackTransaction(driver);
        return policyViolation;
      }

      // Apply plan operations or skip if marker already at destination
      const markerAtDestination = this.markerMatchesDestination(existingMarker, options.plan);
      let operationsExecuted: number;
      let executedOperations: readonly MigrationPlanOperation<PostgresPlanTargetDetails>[];

      if (markerAtDestination) {
        operationsExecuted = 0;
        executedOperations = [];
      } else {
        const applyResult = await this.applyPlan(driver, options);
        if (!applyResult.ok) {
          await this.rollbackTransaction(driver);
          return applyResult;
        }
        operationsExecuted = applyResult.operationsExecuted;
        executedOperations = applyResult.executedOperations;
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
        await this.rollbackTransaction(driver);
        return runnerFailure('SCHEMA_VERIFY_FAILED', schemaVerifyResult.summary, {
          why: 'The resulting database schema does not satisfy the destination contract.',
          meta: {
            issues: schemaVerifyResult.schema.issues,
          },
        });
      }

      // Record marker and ledger entries
      await this.upsertMarker(driver, options, existingMarker);
      await this.recordLedgerEntry(driver, options, existingMarker, executedOperations);

      await this.commitTransaction(driver);
      return runnerSuccess({
        operationsPlanned: options.plan.operations.length,
        operationsExecuted,
      });
    } catch (error) {
      await this.rollbackTransaction(driver);
      // Re-throw unexpected errors (fail fast)
      throw error;
    }
  }

  private async applyPlan(
    driver: MigrationRunnerExecuteOptions<PostgresPlanTargetDetails>['driver'],
    options: MigrationRunnerExecuteOptions<PostgresPlanTargetDetails>,
  ): Promise<
    | {
        readonly ok: true;
        readonly operationsExecuted: number;
        readonly executedOperations: readonly MigrationPlanOperation<PostgresPlanTargetDetails>[];
      }
    | MigrationRunnerFailure
  > {
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

        const precheckFailure = await this.runExpectationSteps(
          driver,
          operation.precheck,
          operation,
          'precheck',
        );
        if (precheckFailure) {
          return precheckFailure;
        }

        await this.runExecuteSteps(driver, operation.execute);

        const postcheckFailure = await this.runExpectationSteps(
          driver,
          operation.postcheck,
          operation,
          'postcheck',
        );
        if (postcheckFailure) {
          return postcheckFailure;
        }

        executedOperations.push(operation);
        operationsExecuted += 1;
      } finally {
        options.callbacks?.onOperationComplete?.(operation);
      }
    }
    return { ok: true, operationsExecuted, executedOperations };
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
  ): Promise<MigrationRunnerFailure | null> {
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
    return null;
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
    plan: MigrationPlan<PostgresPlanTargetDetails>,
  ): MigrationRunnerFailure | null {
    const allowedClasses = new Set(plan.policy.allowedOperationClasses);
    for (const operation of plan.operations) {
      if (!allowedClasses.has(operation.operationClass)) {
        return runnerFailure(
          'POLICY_VIOLATION',
          `Operation ${operation.id} has class "${operation.operationClass}" which is not allowed by policy.`,
          {
            why: `Policy only allows: ${plan.policy.allowedOperationClasses.join(', ')}.`,
            meta: {
              operationId: operation.id,
              operationClass: operation.operationClass,
              allowedClasses: plan.policy.allowedOperationClasses,
            },
          },
        );
      }
    }
    return null;
  }

  private ensureMarkerCompatibility(
    marker: ContractMarkerRecord | null,
    plan: MigrationRunnerExecuteOptions<PostgresPlanTargetDetails>['plan'],
  ): MigrationRunnerFailure | null {
    const origin = plan.origin ?? null;
    if (!origin) {
      if (!marker) {
        return null;
      }
      if (this.markerMatchesDestination(marker, plan)) {
        return null;
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
    return null;
  }

  private ensurePlanMatchesDestinationContract(
    destination: MigrationPlanContractInfo,
    contract: MigrationRunnerExecuteOptions<PostgresPlanTargetDetails>['destinationContract'],
  ): MigrationRunnerFailure | null {
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
    return null;
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
