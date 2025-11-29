import type { ContractMarkerRecord } from '@prisma-next/contract/types';
import type {
  ControlDriverInstance,
  ControlExtensionDescriptor,
} from '@prisma-next/core-control-plane/types';
import type { SqlControlAdapter } from '@prisma-next/family-sql/control-adapter';
import {
  ensureSchemaStatement,
  ensureTableStatement,
  readContractMarker,
  writeContractMarker,
} from '@prisma-next/sql-runtime';
import { type } from 'arktype';
import { AdvisoryLockError, acquireAdvisoryLock, releaseAdvisoryLock } from './advisory-locks';
import { SqlMigrationExecutionError } from './errors';
import { executeOperation } from './execute-operations';
import type { ExecuteMigrationResult, SqlMigrationPlan } from './ir';
import { ensureLedgerTable, generateEdgeId, writeLedgerEntry } from './ledger';

/**
 * Parses meta field from database result.
 */
function parseMeta(meta: unknown): Record<string, unknown> {
  if (meta === null || meta === undefined) {
    return {};
  }

  let parsed: unknown;
  if (typeof meta === 'string') {
    try {
      parsed = JSON.parse(meta);
    } catch {
      return {};
    }
  } else {
    parsed = meta;
  }

  const MetaSchema = type({ '[string]': 'unknown' });
  const result = MetaSchema(parsed);
  if (result instanceof type.errors) {
    return {};
  }

  return result as Record<string, unknown>;
}

/**
 * Parses a contract marker row from database query result.
 */
function parseContractMarkerRow(row: unknown): ContractMarkerRecord {
  const ContractMarkerRowSchema = type({
    core_hash: 'string',
    profile_hash: 'string',
    'contract_json?': 'unknown | null',
    'canonical_version?': 'number | null',
    'updated_at?': 'Date | string',
    'app_tag?': 'string | null',
    'meta?': 'unknown | null',
  });

  const result = ContractMarkerRowSchema(row);
  if (result instanceof type.errors) {
    const messages = result.map((p: { message: string }) => p.message).join('; ');
    throw new Error(`Invalid contract marker row: ${messages}`);
  }

  const validatedRow = result as {
    core_hash: string;
    profile_hash: string;
    contract_json?: unknown | null;
    canonical_version?: number | null;
    updated_at?: Date | string;
    app_tag?: string | null;
    meta?: unknown | null;
  };

  const updatedAt = validatedRow.updated_at
    ? validatedRow.updated_at instanceof Date
      ? validatedRow.updated_at
      : new Date(validatedRow.updated_at)
    : new Date();

  return {
    coreHash: validatedRow.core_hash,
    profileHash: validatedRow.profile_hash,
    contractJson: validatedRow.contract_json ?? null,
    canonicalVersion: validatedRow.canonical_version ?? null,
    updatedAt,
    appTag: validatedRow.app_tag ?? null,
    meta: parseMeta(validatedRow.meta),
  };
}

/**
 * Reads the contract marker from the database.
 */
async function readMarker(
  driver: ControlDriverInstance<'postgres'>,
): Promise<ContractMarkerRecord | null> {
  const markerStatement = readContractMarker();
  const queryResult = await driver.query<{
    core_hash: string;
    profile_hash: string;
    contract_json: unknown | null;
    canonical_version: number | null;
    updated_at: Date | string;
    app_tag: string | null;
    meta: unknown | null;
  }>(markerStatement.sql, markerStatement.params);

  if (queryResult.rows.length === 0) {
    return null;
  }

  const markerRow = queryResult.rows[0];
  if (!markerRow) {
    throw new Error('Database query returned unexpected result structure');
  }

  return parseContractMarkerRow(markerRow);
}

/**
 * Executes a migration plan, applying operations to the database and updating the marker.
 *
 * This function orchestrates the complete migration execution flow:
 * 1. Validates marker state (absent for init mode)
 * 2. Acquires advisory lock
 * 3. Ensures schema/tables exist
 * 4. Applies operations in order
 * 5. Updates marker atomically
 * 6. Writes ledger entry
 * 7. Releases lock (always, even on error)
 *
 * @param options - Execution options
 * @param options.plan - Migration plan to execute
 * @param options.driver - PostgreSQL driver instance
 * @param options.adapter - SQL control adapter (for future extension operation support)
 * @param options.extensions - Extension descriptors (for future extension operation support)
 * @returns Promise resolving to execution result
 */
export async function executeMigration(options: {
  readonly plan: SqlMigrationPlan;
  readonly driver: ControlDriverInstance<'postgres'>;
  readonly adapter: SqlControlAdapter<'postgres'>;
  readonly extensions: readonly ControlExtensionDescriptor<'sql', 'postgres'>[];
}): Promise<ExecuteMigrationResult> {
  const { plan, driver } = options;
  let lockAcquired = false;

  try {
    // Step 1: Validate marker state
    const existingMarker = await readMarker(driver);

    if (plan.mode === 'init') {
      if (existingMarker !== null) {
        throw new SqlMigrationExecutionError(
          `Cannot execute init migration: marker already exists. Use 'db update' or explicit migrations instead.`,
          'PN-MIGRATION-EXEC-0001',
          {
            mode: plan.mode,
            existingCoreHash: existingMarker.coreHash,
            existingProfileHash: existingMarker.profileHash,
          },
        );
      }
    } else if (plan.mode === 'update') {
      // For update mode, verify marker matches fromContract
      if (existingMarker === null) {
        throw new SqlMigrationExecutionError(
          `Cannot execute update migration: marker not found. Use 'db init' first.`,
          'PN-MIGRATION-EXEC-0002',
          { mode: plan.mode },
        );
      }
      if (existingMarker.coreHash !== plan.fromContract.coreHash) {
        throw new SqlMigrationExecutionError(
          `Cannot execute update migration: marker core hash mismatch. Expected ${plan.fromContract.coreHash}, found ${existingMarker.coreHash}`,
          'PN-MIGRATION-EXEC-0003',
          {
            mode: plan.mode,
            expectedCoreHash: plan.fromContract.coreHash,
            actualCoreHash: existingMarker.coreHash,
          },
        );
      }
    }

    // Step 2: Acquire advisory lock
    await acquireAdvisoryLock(driver);
    lockAcquired = true;

    // Step 3: Ensure schema/tables exist
    await driver.query(ensureSchemaStatement.sql, ensureSchemaStatement.params);
    await driver.query(ensureTableStatement.sql, ensureTableStatement.params);
    await ensureLedgerTable(driver);

    // Step 4: Apply operations
    let operationsApplied = 0;
    for (const operation of plan.operations) {
      try {
        const statement = executeOperation(operation);
        await driver.query(statement.sql, statement.params);
        operationsApplied++;
      } catch (error) {
        throw new SqlMigrationExecutionError(
          `Failed to execute operation ${operation.kind}: ${error instanceof Error ? error.message : String(error)}`,
          'PN-MIGRATION-EXEC-0004',
          {
            operationKind: operation.kind,
            operationIndex: operationsApplied,
            totalOperations: plan.operations.length,
            error: error instanceof Error ? error.message : String(error),
          },
        );
      }
    }

    // Step 5: Update marker
    const writeStatements = writeContractMarker({
      coreHash: plan.toContract.coreHash,
      profileHash: plan.toContract.profileHash ?? plan.toContract.coreHash,
      contractJson: plan.toContract,
      canonicalVersion: 1,
    });

    // Use INSERT ... ON CONFLICT for idempotent upsert
    const markerSql =
      existingMarker === null ? writeStatements.insert.sql : writeStatements.update.sql;
    const markerParams =
      existingMarker === null ? writeStatements.insert.params : writeStatements.update.params;

    await driver.query(markerSql, markerParams);
    const markerUpdated = true;

    // Step 6: Write ledger entry
    const edgeId = generateEdgeId(plan.fromContract.coreHash, plan.toContract.coreHash);
    await writeLedgerEntry(driver, {
      edgeId,
      fromCoreHash: plan.fromContract.coreHash,
      toCoreHash: plan.toContract.coreHash,
      fromProfileHash: plan.fromContract.profileHash ?? plan.fromContract.coreHash,
      toProfileHash: plan.toContract.profileHash ?? plan.toContract.coreHash,
      mode: plan.mode,
      operationCount: operationsApplied,
      ...(plan.summary !== undefined ? { summary: plan.summary } : {}),
    });

    // Step 7: Release lock (in finally block)
    // Success case
    const summary =
      operationsApplied === 0
        ? 'Migration executed (no operations needed)'
        : `Migration executed successfully: ${operationsApplied} operation${operationsApplied === 1 ? '' : 's'} applied`;

    return {
      ok: true,
      operationsApplied,
      markerUpdated,
      summary,
    };
  } catch (error) {
    // Error case
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
  } finally {
    // Always release lock
    if (lockAcquired) {
      await releaseAdvisoryLock(driver);
    }
  }
}
