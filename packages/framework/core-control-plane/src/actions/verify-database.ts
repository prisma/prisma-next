import type { ContractIR } from '@prisma-next/contract/ir';
import type { PrismaNextConfig } from '../config-types';
import { errorDriverRequired, errorUnexpected } from '../errors';

/**
 * Removes readonly modifiers from all properties of a type.
 */
type Writable<T> = { -readonly [P in keyof T]: T[P] };

/**
 * Result type for database verification operations.
 * Returned by verifyDatabase().
 */
export interface VerifyDatabaseResult {
  readonly ok: boolean;
  readonly code?: string;
  readonly summary: string;
  readonly contract: {
    readonly coreHash: string;
    readonly profileHash?: string;
  };
  readonly marker?: {
    readonly coreHash?: string;
    readonly profileHash?: string;
  };
  readonly target: {
    readonly expected: string;
    readonly actual?: string;
  };
  readonly meta?: {
    readonly configPath?: string;
    readonly contractPath: string;
  };
  readonly timings: {
    readonly total: number;
  };
}

export interface VerifyDatabaseOptions {
  readonly config: PrismaNextConfig;
  readonly contractIR: ContractIR;
  readonly dbUrl: string;
  readonly contractPath?: string;
  readonly configPath?: string;
}

/**
 * Derives summary message from verification result.
 */
function deriveSummary(ok: boolean, code?: string): string {
  if (ok) {
    return 'Database matches contract';
  }
  switch (code) {
    case 'PN-RTM-3001':
      return 'Marker missing';
    case 'PN-RTM-3002':
      return 'Hash mismatch';
    case 'PN-RTM-3003':
      return 'Target mismatch';
    default:
      return 'Verification failed';
  }
}

/**
 * Programmatic API for verifying database contract markers.
 * Accepts config object, ContractIR, and dbUrl (no file I/O).
 * Uses family.readMarker() hook to read marker and compares contract against database marker.
 *
 * @param options - Options for database verification
 * @returns Result with verification status, hashes, target info, meta, and timings
 * @throws Error if database connection fails or verification fails
 */
export async function verifyDatabase(
  options: VerifyDatabaseOptions,
): Promise<VerifyDatabaseResult> {
  const startTime = Date.now();

  try {
    const { config, contractIR, dbUrl, contractPath, configPath } = options;

    // Obtain driver: driver is required
    if (!config.driver) {
      throw errorDriverRequired();
    }
    const driver = await config.driver.create(dbUrl);

    try {
      // Type guard to ensure contract has required properties
      if (
        typeof contractIR !== 'object' ||
        contractIR === null ||
        !('coreHash' in contractIR) ||
        !('target' in contractIR) ||
        typeof contractIR.coreHash !== 'string' ||
        typeof contractIR.target !== 'string'
      ) {
        throw errorUnexpected('Contract is missing required fields: coreHash or target', {
          why: 'Contract is missing required fields: coreHash or target',
        });
      }

      // Extract contract hashes and target
      const contractCoreHash = contractIR.coreHash;
      const contractProfileHash =
        'profileHash' in contractIR && typeof contractIR.profileHash === 'string'
          ? contractIR.profileHash
          : undefined;
      const contractTarget = contractIR.target;

      // Read marker from database using family hook
      const marker = await config.family.readMarker(driver);

      // Check marker presence
      if (!marker) {
        const totalTime = Date.now() - startTime;
        const code = 'PN-RTM-3001';
        const result: Writable<VerifyDatabaseResult> = {
          ok: false,
          code,
          summary: deriveSummary(false, code),
          contract: {
            coreHash: contractCoreHash,
            ...(contractProfileHash ? { profileHash: contractProfileHash } : {}),
          },
          target: {
            expected: config.target.id,
          },
          timings: {
            total: totalTime,
          },
          meta: {
            contractPath: contractPath ?? 'src/prisma/contract.json',
            ...(configPath ? { configPath } : {}),
          },
        };
        return result satisfies VerifyDatabaseResult;
      }

      // Compare target
      if (contractTarget !== config.target.id) {
        const totalTime = Date.now() - startTime;
        const code = 'PN-RTM-3003';
        const result: Writable<VerifyDatabaseResult> = {
          ok: false,
          code,
          summary: deriveSummary(false, code),
          contract: {
            coreHash: contractCoreHash,
            ...(contractProfileHash ? { profileHash: contractProfileHash } : {}),
          },
          marker: {
            coreHash: marker.coreHash,
            ...(marker.profileHash ? { profileHash: marker.profileHash } : {}),
          },
          target: {
            expected: config.target.id,
            actual: contractTarget,
          },
          timings: {
            total: totalTime,
          },
          meta: {
            contractPath: contractPath ?? 'src/prisma/contract.json',
            ...(configPath ? { configPath } : {}),
          },
        };
        return result satisfies VerifyDatabaseResult;
      }

      // Compare hashes
      if (marker.coreHash !== contractCoreHash) {
        const totalTime = Date.now() - startTime;
        const code = 'PN-RTM-3002';
        const result: Writable<VerifyDatabaseResult> = {
          ok: false,
          code,
          summary: deriveSummary(false, code),
          contract: {
            coreHash: contractCoreHash,
            ...(contractProfileHash ? { profileHash: contractProfileHash } : {}),
          },
          marker: {
            coreHash: marker.coreHash,
            ...(marker.profileHash ? { profileHash: marker.profileHash } : {}),
          },
          target: {
            expected: config.target.id,
          },
          timings: {
            total: totalTime,
          },
          meta: {
            contractPath: contractPath ?? 'src/prisma/contract.json',
            ...(configPath ? { configPath } : {}),
          },
        };
        return result satisfies VerifyDatabaseResult;
      }

      // Compare profile hash if present
      if (contractProfileHash && marker.profileHash !== contractProfileHash) {
        const totalTime = Date.now() - startTime;
        const code = 'PN-RTM-3002';
        const result: Writable<VerifyDatabaseResult> = {
          ok: false,
          code,
          summary: deriveSummary(false, code),
          contract: {
            coreHash: contractCoreHash,
            profileHash: contractProfileHash,
          },
          marker: {
            coreHash: marker.coreHash,
            ...(marker.profileHash ? { profileHash: marker.profileHash } : {}),
          },
          target: {
            expected: config.target.id,
          },
          timings: {
            total: totalTime,
          },
          meta: {
            contractPath: contractPath ?? 'src/prisma/contract.json',
            ...(configPath ? { configPath } : {}),
          },
        };
        return result satisfies VerifyDatabaseResult;
      }

      // Success - all checks passed
      const totalTime = Date.now() - startTime;
      const result: Writable<VerifyDatabaseResult> = {
        ok: true,
        summary: deriveSummary(true),
        contract: {
          coreHash: contractCoreHash,
          ...(contractProfileHash ? { profileHash: contractProfileHash } : {}),
        },
        marker: {
          coreHash: marker.coreHash,
          ...(marker.profileHash ? { profileHash: marker.profileHash } : {}),
        },
        target: {
          expected: config.target.id,
        },
        timings: {
          total: totalTime,
        },
        meta: {
          contractPath: contractPath ?? 'src/prisma/contract.json',
          ...(configPath ? { configPath } : {}),
        },
      };
      return result satisfies VerifyDatabaseResult;
    } catch (error) {
      // Wrap errors in structured errors
      if (error instanceof Error) {
        // Check if it's the contract validation error
        if (error.message.includes('Contract is missing required fields: coreHash or target')) {
          throw errorUnexpected(error.message, {
            why: error.message,
          });
        }
        // Check if it's the database query result structure error
        if (error.message.includes('Database query returned unexpected result structure')) {
          throw errorUnexpected(error.message, {
            why: error.message,
          });
        }
        throw error;
      }
      throw errorUnexpected(String(error), {
        why: String(error),
      });
    } finally {
      // Ensure driver connection is closed
      await driver.close();
    }
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error(`Failed to verify database: ${String(error)}`);
  }
}
