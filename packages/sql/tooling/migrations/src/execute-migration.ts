import { SqlMigrationExecutionError } from './errors';
import type { SqlMigrationExecutor } from './executor';
import { AdvisoryLockError } from './executor';
import type { ExecuteMigrationResult, SqlMigrationPlan } from './ir';

/**
 * Executes a migration plan, applying operations to the database and updating the marker.
 *
 * This function orchestrates the complete migration execution flow:
 * 1. Reads and validates marker state
 * 2. Acquires migration lock
 * 3. Ensures migration infrastructure exists
 * 4. Applies operations in order
 * 5. Updates marker atomically
 * 6. Writes ledger entry
 * 7. Releases lock (always, even on error)
 *
 * All DB-specific behavior is delegated to the executor (marker reading/writing,
 * lock acquisition, infrastructure setup, operation lowering, ledger writing).
 *
 * @param options - Execution options
 * @param options.plan - Migration plan to execute
 * @param options.driver - Driver instance (target-specific)
 * @param options.executor - Migration executor implementing DB-specific behavior
 * @returns Promise resolving to execution result
 */
export async function executeMigration<TDriver>(options: {
  readonly plan: SqlMigrationPlan;
  readonly driver: TDriver;
  readonly executor: SqlMigrationExecutor<TDriver>;
}): Promise<ExecuteMigrationResult> {
  const { plan, driver, executor } = options;

  try {
    // Step 1: Read marker
    const marker = await executor.readMarker(driver);

    // Step 2: Validate marker state
    await executor.validateMarkerState(plan, marker);

    // Step 3: Acquire lock and execute migration
    return await executor.withMigrationLock(driver, async () => {
      // Step 4: Ensure infrastructure exists
      await executor.ensureInfrastructure(driver);

      // Step 5: Apply operations
      let operationsApplied = 0;
      for (let index = 0; index < plan.operations.length; index++) {
        const operation = plan.operations[index];
        if (!operation) {
          continue;
        }
        await executor.applyOperation(driver, operation, index);
        operationsApplied++;
      }

      // Step 6: Update marker
      await executor.updateMarker(driver, plan, marker);

      // Step 7: Write ledger entry
      await executor.writeLedger(driver, plan, operationsApplied);

      // Success case
      const summary =
        operationsApplied === 0
          ? 'Migration executed (no operations needed)'
          : `Migration executed successfully: ${operationsApplied} operation${operationsApplied === 1 ? '' : 's'} applied`;

      return {
        ok: true,
        operationsApplied,
        markerUpdated: true,
        summary,
      };
    });
  } catch (error) {
    // Error case - map executor errors to result
    if (error instanceof AdvisoryLockError) {
      return {
        ok: false,
        operationsApplied: 0,
        markerUpdated: false,
        summary: `Migration execution failed: ${error.message}`,
        error: {
          code: error.code,
          message: error.message,
        },
      };
    }

    if (error instanceof SqlMigrationExecutionError) {
      return {
        ok: false,
        operationsApplied: 0,
        markerUpdated: false,
        summary: `Migration execution failed: ${error.message}`,
        error: {
          code: error.code,
          message: error.message,
          ...(error.details !== undefined ? { details: error.details } : {}),
        },
      };
    }

    // Unexpected error
    return {
      ok: false,
      operationsApplied: 0,
      markerUpdated: false,
      summary: `Migration execution failed: ${error instanceof Error ? error.message : String(error)}`,
      error: {
        code: 'PN-MIGRATION-EXEC-0000',
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}
