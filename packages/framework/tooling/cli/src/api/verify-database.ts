import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import { createPostgresDriver } from '@prisma-next/driver-postgres/runtime';
import { parseContractMarkerRow } from '@prisma-next/runtime-executor';
import { readContractMarker } from '@prisma-next/sql-runtime';
import { loadConfig } from '../config-loader';

export interface VerifyDatabaseOptions {
  readonly dbUrl?: string;
  readonly configPath?: string;
}

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
  readonly missingCodecs?: readonly string[];
  readonly timings: {
    readonly total: number;
  };
}

/**
 * Programmatic API for verifying database contract markers.
 * Loads config and contract, connects to database, reads marker, and compares hashes/target.
 *
 * @param options - Options for database verification
 * @returns Result with verification status, hashes, target info, and timings
 * @throws Error if config/contract loading or database connection fails
 */
export async function verifyDatabase(
  options: VerifyDatabaseOptions = {},
): Promise<VerifyDatabaseResult> {
  const startTime = Date.now();

  try {
    // Load config
    const config = await loadConfig(options.configPath);

    // Resolve database URL
    const dbUrl = options.dbUrl ?? config.db?.url ?? process.env.DATABASE_URL;
    if (!dbUrl) {
      throw new Error(
        'Database URL is required. Provide --db flag, config.db.url, or DATABASE_URL environment variable.',
      );
    }

    // Load contract from emitted artifacts
    // Resolve contract path relative to current working directory (project root)
    const contractPath = config.contract?.output ?? 'src/prisma/contract.json';
    const contractJsonPath = resolve(contractPath);
    const contractJsonContent = await readFile(contractJsonPath, 'utf-8');
    const contractJson = JSON.parse(contractJsonContent) as Record<string, unknown>;

    // Validate contract using family validator
    const contractIR = config.family.validateContractIR(contractJson) as SqlContract<SqlStorage>;

    // Extract contract hashes and target
    const contractCoreHash = contractIR.coreHash;
    const contractProfileHash = contractIR.profileHash;
    const contractTarget = contractIR.target;

    // Connect to database and read marker
    const driver = createPostgresDriver(dbUrl, { cursor: { disabled: true } });
    try {
      await driver.connect();

      const markerStatement = readContractMarker();
      const queryResult = await driver.query<{
        core_hash: string;
        profile_hash: string;
        contract_json: unknown | null;
        canonical_version: number | null;
        updated_at: Date | string;
        app_tag: string | null;
        meta: unknown | null;
      }>(markerStatement.sql, [...markerStatement.params]);

      // Check marker presence
      if (queryResult.rows.length === 0) {
        const totalTime = Date.now() - startTime;
        return {
          ok: false,
          code: 'PN-RTM-3001',
          summary: 'Marker missing',
          contract: {
            coreHash: contractCoreHash,
            profileHash: contractProfileHash,
          },
          target: {
            expected: config.target.id,
          },
          timings: {
            total: totalTime,
          },
        };
      }

      // Parse marker row
      const markerRow = queryResult.rows[0];
      if (!markerRow) {
        throw new Error('Unexpected: query returned rows but first row is undefined');
      }
      const marker = parseContractMarkerRow(markerRow);

      // Compare target
      const expectedTarget = config.target.id;
      if (contractTarget !== expectedTarget) {
        const totalTime = Date.now() - startTime;
        return {
          ok: false,
          code: 'PN-RTM-3003',
          summary: 'Target mismatch',
          contract: {
            coreHash: contractCoreHash,
            profileHash: contractProfileHash,
          },
          marker: {
            coreHash: marker.coreHash,
            profileHash: marker.profileHash,
          },
          target: {
            expected: expectedTarget,
            actual: contractTarget,
          },
          timings: {
            total: totalTime,
          },
        };
      }

      // Compare hashes
      if (marker.coreHash !== contractCoreHash) {
        const totalTime = Date.now() - startTime;
        return {
          ok: false,
          code: 'PN-RTM-3002',
          summary: 'Hash mismatch',
          contract: {
            coreHash: contractCoreHash,
            profileHash: contractProfileHash,
          },
          marker: {
            coreHash: marker.coreHash,
            profileHash: marker.profileHash,
          },
          target: {
            expected: expectedTarget,
          },
          timings: {
            total: totalTime,
          },
        };
      }

      // Compare profile hash if present
      if (contractProfileHash && marker.profileHash !== contractProfileHash) {
        const totalTime = Date.now() - startTime;
        return {
          ok: false,
          code: 'PN-RTM-3002',
          summary: 'Hash mismatch',
          contract: {
            coreHash: contractCoreHash,
            profileHash: contractProfileHash,
          },
          marker: {
            coreHash: marker.coreHash,
            profileHash: marker.profileHash,
          },
          target: {
            expected: expectedTarget,
          },
          timings: {
            total: totalTime,
          },
        };
      }

      // Success - all checks passed
      const totalTime = Date.now() - startTime;
      return {
        ok: true,
        summary: 'Database matches contract',
        contract: {
          coreHash: contractCoreHash,
          profileHash: contractProfileHash,
        },
        marker: {
          coreHash: marker.coreHash,
          profileHash: marker.profileHash,
        },
        target: {
          expected: expectedTarget,
        },
        timings: {
          total: totalTime,
        },
      };
    } finally {
      await driver.close();
    }
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error(`Failed to verify database: ${String(error)}`);
  }
}

