import type { ContractMarkerRecord } from '@prisma-next/contract/types';
import type {
  ControlDriverInstance,
  ControlExtensionDescriptor,
} from '@prisma-next/core-control-plane/types';
import { SqlMigrationExecutionError } from '@prisma-next/sql-migrations/errors';
import type { SqlMigrationExecutor } from '@prisma-next/sql-migrations/executor';
import type { SqlMigrationOperation, SqlMigrationPlan } from '@prisma-next/sql-migrations/ir';
import { acquireAdvisoryLock, releaseAdvisoryLock } from './advisory-locks';
import { executeOperation } from './execute-operations';
import { ensureLedgerTable, generateEdgeId, writeLedgerEntry } from './ledger';
import { ensureMarkerTable, ensureSchema, readMarker, writeMarker } from './marker';

/**
 * Creates a Postgres migration executor.
 *
 * @param driver - Postgres driver instance
 * @param extensions - Extension descriptors (for future extension operation support)
 * @returns Postgres migration executor
 */
export function createPostgresMigrationExecutor(
  _driver: ControlDriverInstance<'postgres'>,
  _extensions: readonly ControlExtensionDescriptor<'sql', 'postgres'>[],
): SqlMigrationExecutor<ControlDriverInstance<'postgres'>> {
  return {
    async readMarker(
      driverInstance: ControlDriverInstance<'postgres'>,
    ): Promise<ContractMarkerRecord | null> {
      return await readMarker(driverInstance);
    },

    async validateMarkerState(
      plan: SqlMigrationPlan,
      marker: ContractMarkerRecord | null,
    ): Promise<void> {
      if (plan.mode === 'init') {
        if (marker !== null) {
          throw new SqlMigrationExecutionError(
            `Cannot execute init migration: marker already exists. Use 'db update' or explicit migrations instead.`,
            'PN-MIGRATION-EXEC-0001',
            {
              mode: plan.mode,
              existingCoreHash: marker.coreHash,
              existingProfileHash: marker.profileHash,
            },
          );
        }
      } else if (plan.mode === 'update') {
        // For update mode, verify marker matches fromContract
        if (marker === null) {
          throw new SqlMigrationExecutionError(
            `Cannot execute update migration: marker not found. Use 'db init' first.`,
            'PN-MIGRATION-EXEC-0002',
            { mode: plan.mode },
          );
        }
        if (marker.coreHash !== plan.fromContract.coreHash) {
          throw new SqlMigrationExecutionError(
            `Cannot execute update migration: marker core hash mismatch. Expected ${plan.fromContract.coreHash}, found ${marker.coreHash}`,
            'PN-MIGRATION-EXEC-0003',
            {
              mode: plan.mode,
              expectedCoreHash: plan.fromContract.coreHash,
              actualCoreHash: marker.coreHash,
            },
          );
        }
      }
    },

    async withMigrationLock<R>(
      driverInstance: ControlDriverInstance<'postgres'>,
      fn: () => Promise<R>,
    ): Promise<R> {
      await acquireAdvisoryLock(driverInstance);
      try {
        return await fn();
      } finally {
        await releaseAdvisoryLock(driverInstance);
      }
    },

    async ensureInfrastructure(driverInstance: ControlDriverInstance<'postgres'>): Promise<void> {
      await ensureSchema(driverInstance);
      await ensureMarkerTable(driverInstance);
      await ensureLedgerTable(driverInstance);
    },

    async applyOperation(
      driverInstance: ControlDriverInstance<'postgres'>,
      operation: SqlMigrationOperation,
      index: number,
    ): Promise<void> {
      try {
        const statement = executeOperation(operation);
        await driverInstance.query(statement.sql, statement.params);
      } catch (error) {
        throw new SqlMigrationExecutionError(
          `Failed to execute operation ${operation.kind}: ${error instanceof Error ? error.message : String(error)}`,
          'PN-MIGRATION-EXEC-0004',
          {
            operationKind: operation.kind,
            operationIndex: index,
            totalOperations: 0, // Will be set by caller if needed
            error: error instanceof Error ? error.message : String(error),
          },
        );
      }
    },

    async updateMarker(
      driverInstance: ControlDriverInstance<'postgres'>,
      plan: SqlMigrationPlan,
      marker: ContractMarkerRecord | null,
    ): Promise<void> {
      await writeMarker(
        driverInstance,
        {
          coreHash: plan.toContract.coreHash,
          profileHash: plan.toContract.profileHash ?? plan.toContract.coreHash,
          contractJson: plan.toContract,
          canonicalVersion: 1,
        },
        marker,
      );
    },

    async writeLedger(
      driverInstance: ControlDriverInstance<'postgres'>,
      plan: SqlMigrationPlan,
      operationsApplied: number,
    ): Promise<void> {
      const edgeId = generateEdgeId(plan.fromContract.coreHash, plan.toContract.coreHash);
      await writeLedgerEntry(driverInstance, {
        edgeId,
        fromCoreHash: plan.fromContract.coreHash,
        toCoreHash: plan.toContract.coreHash,
        fromProfileHash: plan.fromContract.profileHash ?? plan.fromContract.coreHash,
        toProfileHash: plan.toContract.profileHash ?? plan.toContract.coreHash,
        mode: plan.mode,
        operationCount: operationsApplied,
        ...(plan.summary !== undefined ? { summary: plan.summary } : {}),
      });
    },
  };
}
