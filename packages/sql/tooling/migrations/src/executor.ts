import type { ContractMarkerRecord } from '@prisma-next/contract/types';
import type { SqlMigrationOperation, SqlMigrationPlan } from './ir';

/**
 * Error thrown when advisory lock cannot be acquired.
 * This is a generic error type that executors can throw.
 */
export class AdvisoryLockError extends Error {
  readonly code = 'PN-MIGRATION-LOCK-0001';
  readonly domain = 'migrate.schema';

  constructor(
    message: string,
    public readonly key?: bigint,
  ) {
    super(message);
    this.name = 'AdvisoryLockError';
  }
}

/**
 * SQL migration executor interface.
 * Encapsulates all DB-specific behavior for executing migrations.
 * Implemented by target-specific adapters (e.g., Postgres, MySQL).
 *
 * @template TDriver - The driver instance type (target-specific)
 */
export interface SqlMigrationExecutor<TDriver> {
  /**
   * Reads the contract marker from the database.
   * Returns null if no marker exists.
   */
  readMarker(driver: TDriver): Promise<ContractMarkerRecord | null>;

  /**
   * Validates marker state against the migration plan.
   * Throws SqlMigrationExecutionError if validation fails.
   */
  validateMarkerState(plan: SqlMigrationPlan, marker: ContractMarkerRecord | null): Promise<void>;

  /**
   * Acquires a migration lock, executes the provided function, and releases the lock.
   * Throws AdvisoryLockError if lock cannot be acquired.
   * Always releases the lock, even if the function throws.
   */
  withMigrationLock<R>(driver: TDriver, fn: () => Promise<R>): Promise<R>;

  /**
   * Ensures migration infrastructure exists (schema, marker table, ledger table).
   * Called once per migration execution, after lock is acquired.
   */
  ensureInfrastructure(driver: TDriver): Promise<void>;

  /**
   * Applies a single migration operation to the database.
   * Throws SqlMigrationExecutionError if operation fails.
   *
   * @param driver - Driver instance
   * @param operation - Operation to apply
   * @param index - Zero-based index of the operation in the plan
   */
  applyOperation(driver: TDriver, operation: SqlMigrationOperation, index: number): Promise<void>;

  /**
   * Updates the contract marker in the database.
   * Chooses insert vs update based on whether marker exists.
   *
   * @param driver - Driver instance
   * @param plan - Migration plan
   * @param marker - Existing marker (null if none exists)
   */
  updateMarker(
    driver: TDriver,
    plan: SqlMigrationPlan,
    marker: ContractMarkerRecord | null,
  ): Promise<void>;

  /**
   * Writes a ledger entry for the applied migration.
   *
   * @param driver - Driver instance
   * @param plan - Migration plan
   * @param operationsApplied - Number of operations that were successfully applied
   */
  writeLedger(driver: TDriver, plan: SqlMigrationPlan, operationsApplied: number): Promise<void>;
}
