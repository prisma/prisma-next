import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadConfig } from '../config-loader';
import { parseContractMarkerRow } from '../utils/marker-parser';

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
 * Loads config and contract, uses config-provided query runner, reads marker via family helper, and compares hashes/target.
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
      throw new Error(
        'Database URL is required. Provide --db flag or config.db.url in prisma-next.config.ts',
      );
    }

    // Check for queryRunnerFactory
    if (!config.db?.queryRunnerFactory) {
      throw new Error(
        'Config.db.queryRunnerFactory is required for db verify. Provide a factory function that returns a query runner.',
      );
    }

    // Load contract from emitted artifacts
    // Resolve contract path relative to current working directory (project root)
    const contractPath = config.contract?.output ?? 'src/prisma/contract.json';
    const contractJsonPath = resolve(contractPath);
    const contractJsonContent = await readFile(contractJsonPath, 'utf-8');
    const contractJson = JSON.parse(contractJsonContent) as Record<string, unknown>;

    // Validate contract using family validator
    const contractIR = config.family.validateContractIR(contractJson);

    // Type guard to ensure contract has required properties
    if (
      typeof contractIR !== 'object' ||
      contractIR === null ||
      !('coreHash' in contractIR) ||
      !('target' in contractIR) ||
      typeof contractIR.coreHash !== 'string' ||
      typeof contractIR.target !== 'string'
    ) {
      throw new Error('Invalid contract: missing coreHash or target');
    }

    // Extract contract hashes and target
    const contractCoreHash = contractIR.coreHash;
    const contractProfileHash =
      'profileHash' in contractIR && typeof contractIR.profileHash === 'string'
        ? contractIR.profileHash
        : undefined;
    const contractTarget = contractIR.target;

    // Create query runner from factory
    const queryRunner = config.db.queryRunnerFactory(dbUrl);

    try {
      // Get marker SQL from family verify helper
      if (!config.family.verify?.readMarkerSql) {
        throw new Error(
          'Family verify.readMarkerSql is required for db verify. The family must provide a readMarkerSql() function.',
        );
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
            contractPath: contractJsonPath,
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
            contractPath: contractJsonPath,
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
            contractPath: contractJsonPath,
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
            contractPath: contractJsonPath,
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
          contractPath: contractJsonPath,
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
