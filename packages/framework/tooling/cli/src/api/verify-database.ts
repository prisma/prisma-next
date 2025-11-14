import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { VerifyDatabaseResult } from '@prisma-next/control-plane/executor';
import { ControlExecutor } from '@prisma-next/control-plane/executor';
import { loadConfig } from '../config-loader';
import {
  errorDatabaseUrlRequired,
  errorDriverRequired,
  errorFamilyReadMarkerRequired,
  errorFileNotFound,
  errorUnexpected,
} from '../utils/cli-errors';

export interface VerifyDatabaseOptions {
  readonly dbUrl?: string;
  readonly configPath?: string;
}

// Re-export for backward compatibility
export type { VerifyDatabaseResult } from '@prisma-next/control-plane/executor';

/**
 * Programmatic API for verifying database contract markers.
 * Loads config and contract, uses driver to create ControlExecutor, and compares contract against database marker.
 *
 * @param options - Options for database verification
 * @returns Result with verification status, hashes, target info, codec coverage, meta, and timings
 * @throws Error if config/contract loading or database connection fails
 */
export async function verifyDatabase(
  options: VerifyDatabaseOptions = {},
): Promise<VerifyDatabaseResult> {
  const startTime = Date.now();

  try {
    // Load config
    const config = await loadConfig(options.configPath);
    const configPath = options.configPath;

    // Resolve database URL
    const dbUrl = options.dbUrl ?? config.db?.url;
    if (!dbUrl) {
      throw errorDatabaseUrlRequired();
    }

    // Load contract from emitted artifacts
    // Resolve contract path relative to current working directory (project root)
    const contractPath = config.contract?.output ?? 'src/prisma/contract.json';
    const contractJsonPath = resolve(contractPath);
    let contractJsonContent: string;
    try {
      contractJsonContent = await readFile(contractJsonPath, 'utf-8');
    } catch (error) {
      if (error instanceof Error && (error as { code?: string }).code === 'ENOENT') {
        throw errorFileNotFound(contractJsonPath, {
          why: `Contract file not found at ${contractJsonPath}`,
        });
      }
      throw errorUnexpected(error instanceof Error ? error.message : String(error), {
        why: `Failed to read contract file: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
    const contractJson = JSON.parse(contractJsonContent) as Record<string, unknown>;

    // Validate contract using family validator
    const contractIR = config.family.validateContractIR(contractJson);

    // Check for family verify.readMarker
    if (!config.family.verify?.readMarker) {
      throw errorFamilyReadMarkerRequired();
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
        contractJsonPath,
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
