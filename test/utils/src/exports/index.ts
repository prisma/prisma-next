import { type StartPrismaDevServerOptions, startPrismaDevServer } from '@prisma/dev';
import getPort from 'get-port';
import { Client } from 'pg';

export * from '../column-descriptors';
export * from '../operation-descriptors';
export * from '../timeouts';

function normalizeConnectionString(raw: string): string {
  // eslint-disable-next-line no-undef
  const url = new URL(raw);
  if (url.hostname === 'localhost' || url.hostname === '::1') {
    url.hostname = '127.0.0.1';
  }
  return url.toString();
}

export interface DevDatabase {
  readonly connectionString: string;
  close(): Promise<void>;
}

/**
 * Allocates available ports automatically using get-port.
 * Lets the OS pick ephemeral ports for parallel-safe allocation.
 */
async function allocatePorts(): Promise<{
  databasePort: number;
  shadowDatabasePort: number;
}> {
  const [databasePort, shadowDatabasePort] = await Promise.all([
    getPort({ host: '127.0.0.1' }),
    getPort({ host: '127.0.0.1' }),
  ]);

  return { databasePort, shadowDatabasePort };
}

/**
 * Checks if an error is a port availability error from @prisma/dev.
 * Handles various error formats that @prisma/dev might throw.
 */
function isPortError(error: unknown): boolean {
  if (error === null || typeof error !== 'object') {
    return false;
  }
  // Check error name (most reliable)
  if ('name' in error && error.name === 'PortNotAvailableError') {
    return true;
  }
  // Check error message as fallback (handles wrapped errors)
  if ('message' in error && typeof error.message === 'string') {
    const message = error.message;
    // Match patterns like "Port number `11601` is not available for service database."
    if (
      (message.includes('Port number') || message.includes('port number')) &&
      (message.includes('is not available') ||
        message.includes('not available') ||
        message.includes('not available for service'))
    ) {
      return true;
    }
  }
  // Check constructor name as additional fallback
  if (error instanceof Error && error.constructor.name === 'PortNotAvailableError') {
    return true;
  }
  // Check if error has a code property that might indicate port errors
  if ('code' in error && typeof error.code === 'string' && error.code.includes('PORT')) {
    return true;
  }
  return false;
}

/**
 * Creates a dev database instance for testing.
 * Automatically handles connection string normalization and cleanup.
 * Retries with new ports if port conflicts occur (race condition handling).
 */
export async function createDevDatabase(
  options?: StartPrismaDevServerOptions,
): Promise<DevDatabase> {
  const maxRetries = 10; // Increased retries for high concurrency scenarios
  let currentOptions: StartPrismaDevServerOptions = {
    databaseConnectTimeoutMillis: 3000,
    ...options,
  };
  let lastError: unknown;

  // If no ports provided, allocate them before first attempt
  if (!currentOptions.databasePort && !currentOptions.shadowDatabasePort) {
    const allocatedPorts = await allocatePorts();
    currentOptions = { ...currentOptions, ...allocatedPorts };
    // Larger initial delay to spread out concurrent attempts (reduces initial contention)
    const initialJitter = Math.random() * 100; // 0-100ms random delay
    await new Promise((resolve) => setTimeout(resolve, initialJitter));
  }

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const server = await startPrismaDevServer(currentOptions);
      return {
        connectionString: normalizeConnectionString(server.database.connectionString),
        async close() {
          await server.close();
        },
      };
    } catch (error) {
      lastError = error;
      const isPort = isPortError(error);
      // If it's a port error and we have retries left, allocate new ports and retry
      if (isPort && attempt < maxRetries - 1) {
        // Exponential backoff: 50ms base delay, increasing with each attempt
        // Plus random jitter to avoid thundering herd
        const baseDelay = 50;
        const exponentialDelay = baseDelay * 2 ** attempt;
        const jitter = Math.random() * 50; // 0-50ms random jitter
        const totalDelay = exponentialDelay + jitter;
        await new Promise((resolve) => setTimeout(resolve, totalDelay));
        // Allocate new ports for the next attempt (always get fresh ports)
        const newPorts = await allocatePorts();
        // Replace all port values to ensure we're using fresh ports
        currentOptions = {
          ...currentOptions,
          databasePort: newPorts.databasePort,
          shadowDatabasePort: newPorts.shadowDatabasePort,
        };
        continue;
      }
      // If it's not a port error or we're out of retries, throw
      throw error;
    }
  }

  // Should never reach here, but TypeScript needs this
  throw lastError;
}

/**
 * Executes a function with a dev database, automatically cleaning up afterward.
 * If no ports are provided, available ports will be automatically allocated to avoid conflicts in parallel execution.
 */
export async function withDevDatabase<T>(
  fn: (ctx: DevDatabase) => Promise<T>,
  options?: StartPrismaDevServerOptions,
): Promise<T> {
  // If no ports specified, automatically allocate available ones to avoid conflicts in parallel execution
  const finalOptions: StartPrismaDevServerOptions = options || {};
  if (!finalOptions.databasePort && !finalOptions.shadowDatabasePort) {
    const allocatedPorts = await allocatePorts();
    Object.assign(finalOptions, allocatedPorts);
  }
  const database = await createDevDatabase(finalOptions);
  try {
    return await fn(database);
  } finally {
    await database.close();
  }
}

/**
 * Executes a function with a database client, automatically cleaning up afterward.
 */
export async function withClient<T>(
  connectionString: string,
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/**
 * Drains an async iterable, consuming all values without collecting them.
 * Useful for testing side effects without memory overhead.
 */
export async function drainAsyncIterable<T>(iterable: AsyncIterable<T>): Promise<void> {
  for await (const _ of iterable) {
    // exhaust iterator
  }
}

/**
 * Collects all values from an async iterable into an array.
 * Useful for testing query results.
 */
export async function collectAsync<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iterable) {
    out.push(item);
  }
  return out;
}

/**
 * Tears down test database by dropping schema and tables.
 * This helper DRYs up the common pattern of database teardown in tests.
 */
export async function teardownTestDatabase(client: Client, tables?: string[]): Promise<void> {
  if (tables && tables.length > 0) {
    for (const table of tables) {
      await client.query(`drop table if exists "${table}"`);
    }
  }
  await client.query('drop schema if exists prisma_contract cascade');
}
