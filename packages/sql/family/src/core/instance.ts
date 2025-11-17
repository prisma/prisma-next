import type { ContractIR } from '@prisma-next/contract/ir';
import type { ContractMarkerRecord, TypesImportSpec } from '@prisma-next/contract/types';
import { emit } from '@prisma-next/core-control-plane/emission';
import type { OperationManifest } from '@prisma-next/core-control-plane/pack-manifest-types';
import type {
  AdapterDescriptor,
  ControlPlaneDriver,
  EmitContractResult,
  ExtensionDescriptor,
  FamilyInstance,
  TargetDescriptor,
  VerifyDatabaseResult,
  VerifyDatabaseSchemaResult,
} from '@prisma-next/core-control-plane/types';
import type { OperationRegistry } from '@prisma-next/operations';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import { sqlTargetFamilyHook } from '@prisma-next/sql-contract-emitter';
import { validateContract } from '@prisma-next/sql-contract-ts/contract';
import type { SqlOperationSignature } from '@prisma-next/sql-operations';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import {
  assembleOperationRegistry,
  extractCodecTypeImports,
  extractExtensionIds,
  extractOperationTypeImports,
} from './assembly';
import { collectSupportedCodecTypeIds, readMarker } from './verify';

/**
 * Private: Converts an OperationManifest (from ExtensionPackManifest) to a SqlOperationSignature.
 * This is SQL-family-specific conversion logic.
 */
function convertOperationManifest(manifest: OperationManifest): SqlOperationSignature {
  return {
    forTypeId: manifest.for,
    method: manifest.method,
    args: manifest.args.map((arg: OperationManifest['args'][number]) => {
      if (arg.kind === 'typeId') {
        if (!arg.type) {
          throw new Error('typeId arg must have type property');
        }
        return { kind: 'typeId' as const, type: arg.type };
      }
      if (arg.kind === 'param') {
        return { kind: 'param' as const };
      }
      if (arg.kind === 'literal') {
        return { kind: 'literal' as const };
      }
      throw new Error(`Invalid arg kind: ${(arg as { kind: unknown }).kind}`);
    }),
    returns: (() => {
      if (manifest.returns.kind === 'typeId') {
        return { kind: 'typeId' as const, type: manifest.returns.type };
      }
      if (manifest.returns.kind === 'builtin') {
        return {
          kind: 'builtin' as const,
          type: manifest.returns.type as 'number' | 'boolean' | 'string',
        };
      }
      throw new Error(`Invalid return kind: ${(manifest.returns as { kind: unknown }).kind}`);
    })(),
    lowering: {
      targetFamily: 'sql',
      strategy: manifest.lowering.strategy,
      template: manifest.lowering.template,
    },
    ...(manifest.capabilities ? { capabilities: manifest.capabilities } : {}),
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

/**
 * State fields for SQL family instance that hold assembly data.
 */
interface SqlFamilyInstanceState {
  readonly operationRegistry: OperationRegistry;
  readonly codecTypeImports: ReadonlyArray<TypesImportSpec>;
  readonly operationTypeImports: ReadonlyArray<TypesImportSpec>;
  readonly extensionIds: ReadonlyArray<string>;
}

export type SqlFamilyInstance = FamilyInstance<
  'sql',
  SqlSchemaIR,
  VerifyDatabaseResult,
  VerifyDatabaseSchemaResult
> &
  SqlFamilyInstanceState;

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

  // Build descriptors array for assembly
  const descriptors = [target, adapter, ...extensions];

  // Assemble operation registry, type imports, and extension IDs
  const operationRegistry = assembleOperationRegistry(descriptors, convertOperationManifest);
  const codecTypeImports = extractCodecTypeImports(descriptors);
  const operationTypeImports = extractOperationTypeImports(descriptors);
  const extensionIds = extractExtensionIds(adapter, target, extensions);

  /**
   * Strips mappings from a contract (mappings are runtime-only).
   */
  function stripMappings(contract: unknown): unknown {
    // Type guard to check if contract has mappings
    if (typeof contract === 'object' && contract !== null && 'mappings' in contract) {
      const { mappings: _mappings, ...contractIR } = contract as {
        mappings?: unknown;
        [key: string]: unknown;
      };
      return contractIR;
    }
    return contract;
  }

  return {
    familyId: 'sql',
    operationRegistry,
    codecTypeImports,
    operationTypeImports,
    extensionIds,

    validateContractIR(contractJson: unknown): unknown {
      // Validate the contract (this normalizes and validates structure/logic)
      const validated = validateContract<SqlContract<SqlStorage>>(contractJson);
      // Strip mappings before returning ContractIR (mappings are runtime-only)
      const { mappings: _mappings, ...contractIR } = validated;
      return contractIR;
    },

    async verify(verifyOptions: {
      readonly driver: ControlPlaneDriver;
      readonly contractIR: unknown;
      readonly expectedTargetId: string;
      readonly contractPath: string;
      readonly configPath?: string;
    }): Promise<VerifyDatabaseResult> {
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
          ...(contractProfileHash ? { contractProfileHash } : {}),
          ...(missingCodecs ? { missingCodecs } : {}),
          ...(codecCoverageSkipped ? { codecCoverageSkipped } : {}),
          ...(configPath ? { configPath } : {}),
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
          ...(contractProfileHash ? { contractProfileHash } : {}),
          ...(missingCodecs ? { missingCodecs } : {}),
          ...(codecCoverageSkipped ? { codecCoverageSkipped } : {}),
          ...(configPath ? { configPath } : {}),
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
          ...(contractProfileHash ? { contractProfileHash } : {}),
          ...(missingCodecs ? { missingCodecs } : {}),
          ...(codecCoverageSkipped ? { codecCoverageSkipped } : {}),
          ...(configPath ? { configPath } : {}),
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
          ...(missingCodecs ? { missingCodecs } : {}),
          ...(codecCoverageSkipped ? { codecCoverageSkipped } : {}),
          ...(configPath ? { configPath } : {}),
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
        ...(contractProfileHash ? { contractProfileHash } : {}),
        ...(missingCodecs ? { missingCodecs } : {}),
        ...(codecCoverageSkipped ? { codecCoverageSkipped } : {}),
        ...(configPath ? { configPath } : {}),
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

    async emitContract({ contractIR }): Promise<EmitContractResult> {
      // Strip mappings if present (mappings are runtime-only)
      const contractWithoutMappings = stripMappings(contractIR);

      // Validate and normalize the contract
      const validatedIR = this.validateContractIR(contractWithoutMappings) as ContractIR;

      const result = await emit(
        validatedIR,
        {
          outputDir: '',
          operationRegistry,
          codecTypeImports,
          operationTypeImports,
          extensionIds,
        },
        sqlTargetFamilyHook,
      );

      return {
        contractJson: result.contractJson,
        contractDts: result.contractDts,
        coreHash: result.coreHash,
        profileHash: result.profileHash,
      };
    },
  };
}
