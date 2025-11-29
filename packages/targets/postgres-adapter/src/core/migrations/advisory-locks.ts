import type { ControlDriverInstance } from '@prisma-next/core-control-plane/types';
import { AdvisoryLockError } from '@prisma-next/sql-migrations/executor';

/**
 * Acquires a PostgreSQL advisory lock for the migrate.schema domain.
 *
 * For v1, uses a simplified approach with a fixed lock key.
 * Future enhancement: derive key from dbUuid stored in marker.meta per ADR 043.
 *
 * @param driver - PostgreSQL driver instance
 * @returns Promise resolving to true if lock acquired
 * @throws AdvisoryLockError if lock cannot be acquired
 */
export async function acquireAdvisoryLock(
  driver: ControlDriverInstance<'postgres'>,
): Promise<boolean> {
  // For v1: Use a fixed lock key for migrate.schema domain
  // TODO: Enhance to derive key from dbUuid in marker.meta per ADR 043
  // Key derivation: xxhash64("prisma-next:migrate.schema:{dbUuid}:-:-")
  // For now, use a simple deterministic key based on domain
  const lockKey = BigInt('0x1234567890abcdef'); // Fixed key for v1

  try {
    // Use pg_try_advisory_lock which returns true if lock acquired, false if already held
    const result = await driver.query<{ pg_try_advisory_lock: boolean }>(
      'SELECT pg_try_advisory_lock($1) as pg_try_advisory_lock',
      [lockKey],
    );

    if (result.rows.length === 0 || result.rows[0] === undefined) {
      throw new AdvisoryLockError(
        'Failed to acquire advisory lock: unexpected query result',
        lockKey,
      );
    }

    const acquired = result.rows[0].pg_try_advisory_lock;

    if (acquired !== true) {
      // Lock is already held by another session (or query returned false/null)
      throw new AdvisoryLockError(
        'Advisory lock is already held by another session. Another migration may be in progress.',
        lockKey,
      );
    }

    return true;
  } catch (error) {
    if (error instanceof AdvisoryLockError) {
      throw error;
    }
    // Wrap other errors
    throw new AdvisoryLockError(
      `Failed to acquire advisory lock: ${error instanceof Error ? error.message : String(error)}`,
      lockKey,
    );
  }
}

/**
 * Releases a PostgreSQL advisory lock for the migrate.schema domain.
 *
 * @param driver - PostgreSQL driver instance
 * @returns Promise resolving when lock is released
 */
export async function releaseAdvisoryLock(
  driver: ControlDriverInstance<'postgres'>,
): Promise<void> {
  // Use the same lock key as acquireAdvisoryLock
  const lockKey = BigInt('0x1234567890abcdef'); // Fixed key for v1

  try {
    // Use pg_advisory_unlock which returns true if lock released, false if not held by this session
    await driver.query('SELECT pg_advisory_unlock($1)', [lockKey]);
    // Note: We don't check the return value - if the lock wasn't held, that's fine
  } catch (error) {
    // Log but don't throw - releasing a lock that wasn't held is not an error
    // In production, we might want to log this for debugging
    if (error instanceof Error) {
      // Silently ignore unlock failures - the lock may have been released already
      // or the connection may have been closed
    }
  }
}
