import type { StartServerOptions } from '@prisma/dev';
import { unstable_startServer } from '@prisma/dev';
import getPort, { portNumbers } from 'get-port';
import { Client } from 'pg';

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
 * Port allocation counter to avoid contention by starting from different port ranges.
 * Each allocation increments this counter, ensuring parallel tests don't all start
 * from the beginning of the port range.
 */
let portAllocationCounter = 0;
const PORT_COUNTER_INCREMENT = 100; // Increment by 100 ports each time to create spacing

/**
 * Gets the next port range offset based on the allocation counter.
 * This ensures different test processes start from different parts of the port range.
 */
function getNextPortOffset(): number {
  // Use atomic-like increment (simple counter is fine for Node.js single-threaded event loop)
  const current = portAllocationCounter;
  portAllocationCounter = (portAllocationCounter + PORT_COUNTER_INCREMENT) % 50_000; // Wrap around
  return current;
}

/**
 * Allocates available ports automatically using get-port.
 * Uses port range 10,000-65,000 to find available ports for parallel test execution.
 * Uses a counter to offset the starting port range, reducing contention.
 */
async function allocatePorts(): Promise<{
  acceleratePort: number;
  databasePort: number;
  shadowDatabasePort: number;
}> {
  // Get offset to avoid all tests starting from the same port range
  const offset = getNextPortOffset();
  const baseMinPort = 10_000;
  const baseMaxPort = 65_000;
  const availableRange = baseMaxPort - baseMinPort; // 55,000 ports available

  // Calculate offset within available range (wrap around if needed)
  const effectiveOffset = offset % availableRange;
  const minPort = baseMinPort + effectiveOffset;
  const maxPort = baseMaxPort;

  const [acceleratePort, databasePort, shadowDatabasePort] = await Promise.all([
    getPort({ host: '127.0.0.1', port: portNumbers(minPort, maxPort) }),
    getPort({ host: '127.0.0.1', port: portNumbers(minPort, maxPort) }),
    getPort({ host: '127.0.0.1', port: portNumbers(minPort, maxPort) }),
  ]);

  return { acceleratePort, databasePort, shadowDatabasePort };
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
    return (
      message.includes('Port number') &&
      (message.includes('is not available') || message.includes('not available'))
    );
  }
  // Check constructor name as additional fallback
  if (error instanceof Error && error.constructor.name === 'PortNotAvailableError') {
    return true;
  }
  return false;
}

/**
 * Creates a dev database instance for testing.
 * Automatically handles connection string normalization and cleanup.
 * Retries with new ports if port conflicts occur (race condition handling).
 */
export async function createDevDatabase(options?: StartServerOptions): Promise<DevDatabase> {
  const maxRetries = 10; // Increased retries for high concurrency scenarios
  let currentOptions: StartServerOptions = options || {};
  let lastError: unknown;

  // Small initial delay to spread out concurrent attempts (reduces initial contention)
  if (!options?.acceleratePort && !options?.databasePort && !options?.shadowDatabasePort) {
    const initialJitter = Math.random() * 50; // 0-50ms random delay
    await new Promise((resolve) => setTimeout(resolve, initialJitter));
  }

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const server = await unstable_startServer(currentOptions);
      return {
        connectionString: normalizeConnectionString(server.database.connectionString),
        async close() {
          await server.close();
        },
      };
    } catch (error) {
      lastError = error;
      // If it's a port error and we have retries left, allocate new ports and retry
      if (isPortError(error) && attempt < maxRetries - 1) {
        // Wait 50ms before retrying to reduce contention
        await new Promise((resolve) => setTimeout(resolve, 50));
        // Allocate new ports for the next attempt
        const newPorts = await allocatePorts();
        // Merge new ports, ensuring we replace any existing port values
        currentOptions = {
          ...currentOptions,
          acceleratePort: newPorts.acceleratePort,
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
  options?: StartServerOptions,
): Promise<T> {
  // If no ports specified, automatically allocate available ones to avoid conflicts in parallel execution
  const finalOptions: StartServerOptions = options || {};
  if (
    !finalOptions.acceleratePort &&
    !finalOptions.databasePort &&
    !finalOptions.shadowDatabasePort
  ) {
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
