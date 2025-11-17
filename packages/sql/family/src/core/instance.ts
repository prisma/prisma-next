import type { ContractMarkerRecord } from '@prisma-next/contract/types';
import type {
  AdapterDescriptor,
  ControlPlaneDriver,
  ExtensionDescriptor,
  FamilyInstance,
  TargetDescriptor,
  VerifyDatabaseResult,
  VerifyDatabaseSchemaResult,
} from '@prisma-next/core-control-plane/types';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import { collectSupportedCodecTypeIds, readMarker } from './verify';

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
 * Creates a VerifyDatabaseResult object with common structure.
 */
function createVerifyResult(options: {
  ok: boolean;
  code?: string;
  summary: string;
  contractCoreHash: string;
  contractProfileHash?: string;
  marker?: ContractMarkerRecord;
  expectedTargetId: string;
  actualTargetId?: string;
  missingCodecs?: readonly string[];
  codecCoverageSkipped?: boolean;
  configPath?: string;
  contractPath: string;
  totalTime: number;
}): VerifyDatabaseResult {
  const contract: { coreHash: string; profileHash?: string } = {
    coreHash: options.contractCoreHash,
  };
  if (options.contractProfileHash) {
    contract.profileHash = options.contractProfileHash;
  }

  const target: { expected: string; actual?: string } = {
    expected: options.expectedTargetId,
  };
  if (options.actualTargetId) {
    target.actual = options.actualTargetId;
  }

  const meta: { contractPath: string; configPath?: string } = {
    contractPath: options.contractPath,
  };
  if (options.configPath) {
    meta.configPath = options.configPath;
  }

  const result: VerifyDatabaseResult = {
    ok: options.ok,
    summary: options.summary,
    contract,
    target,
    meta,
    timings: {
      total: options.totalTime,
    },
  };

  if (options.code) {
    (result as { code?: string }).code = options.code;
  }

  if (options.marker) {
    (result as { marker?: { coreHash: string; profileHash: string } }).marker = {
      coreHash: options.marker.coreHash,
      profileHash: options.marker.profileHash,
    };
  }

  if (options.missingCodecs) {
    (result as { missingCodecs?: readonly string[] }).missingCodecs = options.missingCodecs;
  }

  if (options.codecCoverageSkipped) {
    (result as { codecCoverageSkipped?: boolean }).codecCoverageSkipped =
      options.codecCoverageSkipped;
  }

  return result;
}

export type SqlFamilyInstance = FamilyInstance<
  'sql',
  SqlSchemaIR,
  VerifyDatabaseResult,
  VerifyDatabaseSchemaResult
>;

interface CreateSqlFamilyInstanceOptions {
  readonly target: TargetDescriptor<'sql'>;
  readonly adapter: AdapterDescriptor<'sql'>;
  readonly extensions: ReadonlyArray<ExtensionDescriptor<'sql'>>;
}

/**
 * Creates a SQL family instance for control-plane operations.
 */
export function createSqlFamilyInstance(
  options: CreateSqlFamilyInstanceOptions,
): SqlFamilyInstance {
  const { target, adapter, extensions } = options;

  return {
    familyId: 'sql',

    async verify(verifyOptions): Promise<VerifyDatabaseResult> {
      const { driver, contractIR, expectedTargetId, contractPath, configPath } = verifyOptions;
      const startTime = Date.now();

      // Type guard to ensure contract has required properties
      if (
        typeof contractIR !== 'object' ||
        contractIR === null ||
        !('coreHash' in contractIR) ||
        !('target' in contractIR) ||
        typeof contractIR.coreHash !== 'string' ||
        typeof contractIR.target !== 'string'
      ) {
        throw new Error('Contract is missing required fields: coreHash or target');
      }

      // Extract contract hashes and target
      const contractCoreHash = contractIR.coreHash;
      const contractProfileHash =
        'profileHash' in contractIR && typeof contractIR.profileHash === 'string'
          ? contractIR.profileHash
          : undefined;
      const contractTarget = contractIR.target;

      // Read marker from database
      const marker = await readMarker(driver);

      // Compute codec coverage (optional)
      let missingCodecs: readonly string[] | undefined;
      let codecCoverageSkipped = false;
      const supportedTypeIds = collectSupportedCodecTypeIds([adapter, target, ...extensions]);
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

      // Check marker presence
      if (!marker) {
        const totalTime = Date.now() - startTime;
        return createVerifyResult({
          ok: false,
          code: 'PN-RTM-3001',
          summary: 'Marker missing',
          contractCoreHash,
          expectedTargetId,
          contractPath,
          totalTime,
          contractProfileHash,
          missingCodecs,
          codecCoverageSkipped,
          configPath,
        });
      }

      // Compare target
      if (contractTarget !== expectedTargetId) {
        const totalTime = Date.now() - startTime;
        return createVerifyResult({
          ok: false,
          code: 'PN-RTM-3003',
          summary: 'Target mismatch',
          contractCoreHash,
          marker,
          expectedTargetId,
          actualTargetId: contractTarget,
          contractPath,
          totalTime,
          contractProfileHash,
          missingCodecs,
          codecCoverageSkipped,
          configPath,
        });
      }

      // Compare hashes
      if (marker.coreHash !== contractCoreHash) {
        const totalTime = Date.now() - startTime;
        return createVerifyResult({
          ok: false,
          code: 'PN-RTM-3002',
          summary: 'Hash mismatch',
          contractCoreHash,
          marker,
          expectedTargetId,
          contractPath,
          totalTime,
          contractProfileHash,
          missingCodecs,
          codecCoverageSkipped,
          configPath,
        });
      }

      // Compare profile hash if present
      if (contractProfileHash && marker.profileHash !== contractProfileHash) {
        const totalTime = Date.now() - startTime;
        return createVerifyResult({
          ok: false,
          code: 'PN-RTM-3002',
          summary: 'Hash mismatch',
          contractCoreHash,
          contractProfileHash,
          marker,
          expectedTargetId,
          contractPath,
          totalTime,
          missingCodecs,
          codecCoverageSkipped,
          configPath,
        });
      }

      // Success - all checks passed
      const totalTime = Date.now() - startTime;
      return createVerifyResult({
        ok: true,
        summary: 'Database matches contract',
        contractCoreHash,
        marker,
        expectedTargetId,
        contractPath,
        totalTime,
        contractProfileHash,
        missingCodecs,
        codecCoverageSkipped,
        configPath,
      });
    },

    async schemaVerify(): Promise<VerifyDatabaseSchemaResult> {
      // TODO: Implement schema verification
      // This will build SqlTypeMetadataRegistry, call adapter introspection,
      // compare contract vs SqlSchemaIR, and return VerifyDatabaseSchemaResult
      throw new Error('schemaVerify not yet implemented');
    },

    async introspect(): Promise<SqlSchemaIR> {
      // TODO: Implement introspection
      // This will build SqlTypeMetadataRegistry and call adapter introspection
      throw new Error('introspect not yet implemented');
    },
  };
}
