import type { ContractIR } from '@prisma-next/contract/ir';
import type { PrismaNextConfig } from '../config-types';
import {
  errorFamilyReadMarkerSqlRequired,
  errorQueryRunnerFactoryRequired,
  errorUnexpected,
} from '../errors';
import { parseContractMarkerRow } from '../utils/marker-parser';

export interface VerifyDatabaseOptions {
  readonly config: PrismaNextConfig;
  readonly contractIR: ContractIR;
  readonly dbUrl: string;
  readonly contractPath?: string;
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
  readonly codecCoverageSkipped?: boolean;
  readonly meta?: {
    readonly configPath?: string;
    readonly contractPath: string;
  };
  readonly timings: {
    readonly total: number;
  };
}

/**
 * Extracts codec type IDs used in contract storage tables.
 * Uses type guards to safely access SQL-specific structure without importing SQL types.
 */
function extractCodecTypeIdsFromContract(contract: unknown): readonly string[] {
  const typeIds = new Set<string>();

  // Type guard for SQL contract structure
  if (
    typeof contract === 'object' &&
    contract !== null &&
    'storage' in contract &&
    typeof contract.storage === 'object' &&
    contract.storage !== null &&
    'tables' in contract.storage
  ) {
    const storage = contract.storage as { tables?: Record<string, unknown> };
    if (storage.tables && typeof storage.tables === 'object') {
      for (const table of Object.values(storage.tables)) {
        if (
          typeof table === 'object' &&
          table !== null &&
          'columns' in table &&
          typeof table.columns === 'object' &&
          table.columns !== null
        ) {
          const columns = table.columns as Record<string, { type?: string } | undefined>;
          for (const column of Object.values(columns)) {
            if (
              column &&
              typeof column === 'object' &&
              'type' in column &&
              typeof column.type === 'string'
            ) {
              typeIds.add(column.type);
            }
          }
        }
      }
    }
  }

  return Array.from(typeIds).sort();
}

/**
 * Programmatic API for verifying database contract markers.
 * Accepts config object, ContractIR, and dbUrl (no file I/O).
 * Uses config-provided query runner, reads marker via family helper, and compares hashes/target.
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

    // Check for queryRunnerFactory
    if (!config.db?.queryRunnerFactory) {
      throw errorQueryRunnerFactoryRequired();
    }

    // Type guard to ensure contract has required properties
    if (
      typeof contractIR !== 'object' ||
      contractIR === null ||
      !('coreHash' in contractIR) ||
      !('target' in contractIR) ||
      typeof contractIR.coreHash !== 'string' ||
      typeof contractIR.target !== 'string'
    ) {
      throw errorUnexpected('Invalid contract structure', {
        why: 'Contract is missing required fields: coreHash or target',
        fix: 'Re-emit the contract using `prisma-next contract emit`',
      });
    }

    // Extract contract hashes and target
    const contractCoreHash = contractIR.coreHash;
    const contractProfileHash =
      'profileHash' in contractIR && typeof contractIR.profileHash === 'string'
        ? contractIR.profileHash
        : undefined;
    const contractTarget = contractIR.target;

    // Create query runner from factory (may be async for ESM dynamic imports)
    const queryRunnerResult = config.db.queryRunnerFactory(dbUrl);
    const queryRunner =
      queryRunnerResult instanceof Promise ? await queryRunnerResult : queryRunnerResult;

    try {
      // Get marker SQL from family verify helper
      if (!config.family.verify?.readMarkerSql) {
        throw errorFamilyReadMarkerSqlRequired();
      }

      const markerStatement = config.family.verify.readMarkerSql();
      const queryResult = await queryRunner.query<{
        core_hash: string;
        profile_hash: string;
        contract_json: unknown | null;
        canonical_version: number | null;
        updated_at: Date | string;
        app_tag: string | null;
        meta: unknown | null;
      }>(markerStatement.sql, markerStatement.params);

      // Compute codec coverage (optional)
      let missingCodecs: readonly string[] | undefined;
      let codecCoverageSkipped = false;
      if (config.family.verify?.collectSupportedCodecTypeIds) {
        const descriptors = [config.adapter, config.target, ...(config.extensions ?? [])];
        const supportedTypeIds = config.family.verify.collectSupportedCodecTypeIds(descriptors);
        if (supportedTypeIds.length === 0) {
          // Helper is present but returns empty (MVP behavior)
          // Coverage check is skipped - missingCodecs remains undefined
          codecCoverageSkipped = true;
        } else {
          const supportedSet = new Set(supportedTypeIds);
          const usedTypeIds = extractCodecTypeIdsFromContract(contractIR);
          const missing = usedTypeIds.filter((id) => !supportedSet.has(id));
          if (missing.length > 0) {
            missingCodecs = missing;
          }
        }
      }

      // Check marker presence
      if (queryResult.rows.length === 0) {
        const totalTime = Date.now() - startTime;
        return {
          ok: false,
          code: 'PN-RTM-3001',
          summary: 'Marker missing',
          contract: {
            coreHash: contractCoreHash,
            ...(contractProfileHash ? { profileHash: contractProfileHash } : {}),
          },
          target: {
            expected: config.target.id,
          },
          ...(missingCodecs ? { missingCodecs } : {}),
          ...(codecCoverageSkipped ? { codecCoverageSkipped } : {}),
          meta: {
            ...(configPath ? { configPath } : {}),
            contractPath: contractPath ?? 'unknown',
          },
          timings: {
            total: totalTime,
          },
        };
      }

      // Parse marker row
      const markerRow = queryResult.rows[0];
      if (!markerRow) {
        throw errorUnexpected('Query returned rows but first row is undefined', {
          why: 'Database query returned unexpected result structure',
        });
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
            ...(contractProfileHash ? { profileHash: contractProfileHash } : {}),
          },
          marker: {
            coreHash: marker.coreHash,
            profileHash: marker.profileHash,
          },
          target: {
            expected: expectedTarget,
            actual: contractTarget,
          },
          ...(missingCodecs ? { missingCodecs } : {}),
          ...(codecCoverageSkipped ? { codecCoverageSkipped } : {}),
          meta: {
            ...(configPath ? { configPath } : {}),
            contractPath: contractPath ?? 'unknown',
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
            ...(contractProfileHash ? { profileHash: contractProfileHash } : {}),
          },
          marker: {
            coreHash: marker.coreHash,
            profileHash: marker.profileHash,
          },
          target: {
            expected: expectedTarget,
          },
          ...(missingCodecs ? { missingCodecs } : {}),
          ...(codecCoverageSkipped ? { codecCoverageSkipped } : {}),
          meta: {
            ...(configPath ? { configPath } : {}),
            contractPath: contractPath ?? 'unknown',
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
            ...(contractProfileHash ? { profileHash: contractProfileHash } : {}),
          },
          marker: {
            coreHash: marker.coreHash,
            profileHash: marker.profileHash,
          },
          target: {
            expected: expectedTarget,
          },
          ...(missingCodecs ? { missingCodecs } : {}),
          ...(codecCoverageSkipped ? { codecCoverageSkipped } : {}),
          meta: {
            ...(configPath ? { configPath } : {}),
            contractPath: contractPath ?? 'unknown',
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
          ...(contractProfileHash ? { profileHash: contractProfileHash } : {}),
        },
        marker: {
          coreHash: marker.coreHash,
          profileHash: marker.profileHash,
        },
        target: {
          expected: expectedTarget,
        },
        ...(missingCodecs ? { missingCodecs } : {}),
        ...(codecCoverageSkipped ? { codecCoverageSkipped } : {}),
        meta: {
          ...(configPath ? { configPath } : {}),
          contractPath: contractPath ?? 'unknown',
        },
        timings: {
          total: totalTime,
        },
      };
    } finally {
      if (queryRunner.close) {
        await queryRunner.close();
      }
    }
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error(`Failed to verify database: ${String(error)}`);
  }
}
