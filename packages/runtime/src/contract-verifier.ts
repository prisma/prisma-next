/**
 * Contract Hash Verifier
 *
 * A production-safe utility that fails fast when an application's compiled contract (IR)
 * does not match the database's applied contract hash.
 */

export interface ContractVerifierOptions {
  /** The expected contract hash from the IR (e.g., "sha256:98f2...") */
  expectedHash: string;
  /** Database client with query method */
  client: { query(sql: string, params?: any[]): Promise<{ rows: any[] }> };
  /** Table name (default: "version") */
  table?: string;
  /** Row ID to check (default: 1) */
  id?: number;
  /** Schema name (default: "prisma_contract") */
  schema?: string;
  /** Number of retries for replica lag (default: 3) */
  retries?: number;
  /** Delay between retries in ms (default: 200) */
  retryDelayMs?: number;
  /** Error mode: 'error' throws, 'warn' logs and continues (default: 'error') */
  mode?: 'error' | 'warn';
}

export type ContractVerification =
  | { ok: true; dbHash: string }
  | {
      ok: false;
      code: 'E_CONTRACT_MISMATCH' | 'E_CONTRACT_MISSING';
      dbHash?: string;
      expected: string;
    };

/**
 * Verifies that the database contract hash matches the expected hash from the IR.
 * Returns a result object instead of throwing.
 */
export async function verifyContract(
  options: ContractVerifierOptions,
): Promise<ContractVerification> {
  const {
    expectedHash,
    client,
    table = 'version',
    id = 1,
    schema = 'prisma_contract',
    retries = 3,
    retryDelayMs = 200,
  } = options;

  const query = `SELECT hash FROM ${schema}.${table} WHERE id = $1`;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const result = await client.query(query, [id]);

      if (result.rows.length === 0) {
        return {
          ok: false,
          code: 'E_CONTRACT_MISSING',
          expected: expectedHash,
        };
      }

      const dbHash = result.rows[0].hash;

      if (dbHash === expectedHash) {
        return { ok: true, dbHash };
      }

      return {
        ok: false,
        code: 'E_CONTRACT_MISMATCH',
        dbHash,
        expected: expectedHash,
      };
    } catch (error) {
      // If this is the last attempt, re-throw the error
      if (attempt === retries) {
        throw error;
      }

      // Wait before retrying (for replica lag)
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }

  // This should never be reached due to the throw above, but TypeScript needs it
  throw new Error('Unexpected error in contract verification');
}

/**
 * Asserts that the database contract hash matches the expected hash.
 * Throws an error with actionable details on mismatch or missing contract.
 */
export async function assertContract(options: ContractVerifierOptions): Promise<void> {
  const result = await verifyContract(options);

  if (result.ok) {
    return;
  }

  const { mode = 'error' } = options;

  if (result.code === 'E_CONTRACT_MISSING') {
    const error = new Error(
      `E_CONTRACT_MISSING: No contract hash row found at ${options.schema || 'prisma_contract'}.${options.table || 'version'}(id=${options.id || 1}).\n` +
        `expected: ${result.expected}\n` +
        `fix: apply migrations or seed ${options.schema || 'prisma_contract'}.${options.table || 'version'} with the expected hash.`,
    );

    if (mode === 'warn') {
      console.warn(error.message);
      return;
    }

    throw error;
  }

  if (result.code === 'E_CONTRACT_MISMATCH') {
    const error = new Error(
      `E_CONTRACT_MISMATCH: Database contract hash differs from application.\n` +
        `app: ${result.expected}\n` +
        `db : ${result.dbHash}\n` +
        `fix: apply migrations for the current contract or deploy the matching build.`,
    );

    if (mode === 'warn') {
      console.warn(error.message);
      return;
    }

    throw error;
  }
}
