import type { ContractIR } from '@prisma-next/contract/ir';
import type { PrismaNextConfig } from '../config-types';
import { errorDriverRequired, errorFamilyReadMarkerSqlRequired, errorUnexpected } from '../errors';
import type { VerifyDatabaseResult } from '../executor';
import { ControlExecutor } from '../executor';

export interface VerifyDatabaseOptions {
  readonly config: PrismaNextConfig;
  readonly contractIR: ContractIR;
  readonly dbUrl: string;
  readonly contractPath?: string;
  readonly configPath?: string;
}

// Re-export for backward compatibility
export type { VerifyDatabaseResult } from '../executor';

/**
 * Programmatic API for verifying database contract markers.
 * Accepts config object, ContractIR, and dbUrl (no file I/O).
 * Uses driver to create ControlExecutor, and compares contract against database marker.
 *
 * @param options - Options for database verification
 * @returns Result with verification status, hashes, target info, codec coverage, meta, and timings
 * @throws Error if database connection fails or verification fails
 */
export async function verifyDatabase(
  options: VerifyDatabaseOptions,
): Promise<VerifyDatabaseResult> {
  const startTime = Date.now();

  try {
    const { config, contractIR, dbUrl, contractPath, configPath } = options;

    // Check for family verify.readMarker
    if (!config.family.verify?.readMarker) {
      throw errorFamilyReadMarkerSqlRequired();
    }

    // Obtain driver: driver is required
    if (!config.driver) {
      throw errorDriverRequired();
    }
    const driver = await config.driver.create(dbUrl);

    // Create ControlExecutor
    const executor = new ControlExecutor({
      driver,
      familyVerify: config.family.verify,
      adapter: config.adapter,
      target: config.target,
      extensions: config.extensions ?? [],
      contractIR,
    });

    try {
      // Verify contract against database
      return await executor.verifyAgainst(
        config.target.id,
        startTime,
        configPath,
        contractPath ?? 'src/prisma/contract.json',
      );
    } catch (error) {
      // Wrap errors from ControlExecutor in structured errors
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
      await executor.close();
    }
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error(`Failed to verify database: ${String(error)}`);
  }
}
