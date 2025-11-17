import type { ContractIR } from '@prisma-next/contract/ir';
import type {
  ContractMarkerRecord,
  TypesImportSpec,
  ValidationContext,
} from '@prisma-next/contract/types';
import {
  canonicalizeContract,
  computeCoreHash,
  computeProfileHash,
} from '@prisma-next/core-control-plane/emission';
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
import type { OperationRegistry, OperationSignature } from '@prisma-next/operations';
import { sqlTargetFamilyHook } from '@prisma-next/sql-contract-emitter';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import { format } from 'prettier';
import {
  assembleOperationRegistry,
  extractCodecTypeImports,
  extractExtensionIds,
  extractOperationTypeImports,
} from './assembly';
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
  readonly convertOperationManifest: (manifest: OperationManifest) => OperationSignature;
}

/**
 * Creates a SQL family instance for control-plane operations.
 */
export function createSqlFamilyInstance(
  options: CreateSqlFamilyInstanceOptions,
): SqlFamilyInstance {
  const { target, adapter, extensions, convertOperationManifest } = options;

  // Build descriptors array for assembly
  const descriptors = [target, adapter, ...extensions];

  // Assemble operation registry, type imports, and extension IDs
  const operationRegistry = assembleOperationRegistry(descriptors, convertOperationManifest);
  const codecTypeImports = extractCodecTypeImports(descriptors);
  const operationTypeImports = extractOperationTypeImports(descriptors);
  const extensionIds = extractExtensionIds(adapter, target, extensions);

  return {
    familyId: 'sql',
    operationRegistry,
    codecTypeImports,
    operationTypeImports,
    extensionIds,

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
      const ir = contractIR as ContractIR;

      // Validate core structure
      if (!ir.targetFamily) {
        throw new Error('ContractIR must have targetFamily');
      }
      if (!ir.target) {
        throw new Error('ContractIR must have target');
      }
      if (!ir.schemaVersion) {
        throw new Error('ContractIR must have schemaVersion');
      }
      if (!ir.models || typeof ir.models !== 'object') {
        throw new Error('ContractIR must have models');
      }
      if (!ir.storage || typeof ir.storage !== 'object') {
        throw new Error('ContractIR must have storage');
      }
      if (!ir.relations || typeof ir.relations !== 'object') {
        throw new Error('ContractIR must have relations');
      }
      if (!ir.extensions || typeof ir.extensions !== 'object') {
        throw new Error('ContractIR must have extensions');
      }
      if (!ir.capabilities || typeof ir.capabilities !== 'object') {
        throw new Error('ContractIR must have capabilities');
      }
      if (!ir.meta || typeof ir.meta !== 'object') {
        throw new Error('ContractIR must have meta');
      }
      if (!ir.sources || typeof ir.sources !== 'object') {
        throw new Error('ContractIR must have sources');
      }

      // Build validation context from instance's assembly state
      const ctx: ValidationContext = {
        ...(operationRegistry ? { operationRegistry } : {}),
        ...(codecTypeImports ? { codecTypeImports } : {}),
        ...(operationTypeImports ? { operationTypeImports } : {}),
        ...(extensionIds ? { extensionIds } : {}),
      };

      // Validate types and structure via hook
      sqlTargetFamilyHook.validateTypes(ir, ctx);
      sqlTargetFamilyHook.validateStructure(ir);

      // Validate extensions are present in contract
      if (extensionIds) {
        const extensions = ir.extensions as Record<string, unknown>;
        for (const extensionId of extensionIds) {
          if (!extensions[extensionId]) {
            throw new Error(
              `Extension "${extensionId}" must appear in contract.extensions.${extensionId}`,
            );
          }
        }
      }

      // Build contract JSON object
      const contractJson = {
        schemaVersion: ir.schemaVersion,
        targetFamily: ir.targetFamily,
        target: ir.target,
        models: ir.models,
        relations: ir.relations,
        storage: ir.storage,
        extensions: ir.extensions,
        capabilities: ir.capabilities,
        meta: ir.meta,
        sources: ir.sources,
      } as const;

      // Compute hashes
      const coreHash = computeCoreHash(contractJson);
      const profileHash = computeProfileHash(contractJson);

      // Canonicalize contract and add _generated metadata
      const contractWithHashes: ContractIR & { coreHash?: string; profileHash?: string } = {
        ...ir,
        schemaVersion: contractJson.schemaVersion,
        coreHash,
        profileHash,
      };
      const contractJsonObj = JSON.parse(canonicalizeContract(contractWithHashes)) as Record<
        string,
        unknown
      >;
      const contractJsonWithMeta = {
        ...contractJsonObj,
        _generated: {
          warning: '⚠️  GENERATED FILE - DO NOT EDIT',
          message: 'This file is automatically generated by "prisma-next emit".',
          regenerate: 'To regenerate, run: prisma-next emit',
        },
      };
      const contractJsonString = JSON.stringify(contractJsonWithMeta, null, 2);

      // Generate contract.d.ts via hook and format with prettier
      const contractDtsRaw = sqlTargetFamilyHook.generateContractTypes(
        ir,
        codecTypeImports ?? [],
        operationTypeImports ?? [],
      );
      const contractDts = await format(contractDtsRaw, {
        parser: 'typescript',
        singleQuote: true,
        semi: true,
        printWidth: 100,
      });

      return {
        contractJson: contractJsonString,
        contractDts,
        coreHash,
        profileHash,
      };
    },
  };
}
