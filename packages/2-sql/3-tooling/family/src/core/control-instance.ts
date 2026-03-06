import type {
  TargetBoundComponentDescriptor,
  TargetDescriptor,
} from '@prisma-next/contract/framework-components';
import type { ContractIR } from '@prisma-next/contract/ir';
import type { ContractMarkerRecord, TypesImportSpec } from '@prisma-next/contract/types';
import { emit } from '@prisma-next/core-control-plane/emission';
import type { CoreSchemaView, SchemaTreeNode } from '@prisma-next/core-control-plane/schema-view';
import type {
  ControlDriverInstance,
  ControlFamilyInstance,
  EmitContractResult,
  OperationContext,
  SignDatabaseResult,
  VerifyDatabaseResult,
  VerifyDatabaseSchemaResult,
} from '@prisma-next/core-control-plane/types';
import type { OperationRegistry } from '@prisma-next/operations';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import { validateContract } from '@prisma-next/sql-contract/validate';
import { sqlTargetFamilyHook } from '@prisma-next/sql-contract-emitter';
import {
  ensureSchemaStatement,
  ensureTableStatement,
  writeContractMarker,
} from '@prisma-next/sql-runtime';
import type { SqlSchemaIR, SqlTableIR } from '@prisma-next/sql-schema-ir/types';
import { ifDefined } from '@prisma-next/utils/defined';
import {
  assembleOperationRegistry,
  extractCodecTypeImports,
  extractExtensionIds,
  extractOperationTypeImports,
  extractParameterizedRenderers,
  extractParameterizedTypeImports,
  type SqlControlDescriptorWithContributions,
} from './assembly';
import type { SqlControlAdapter } from './control-adapter';
import type {
  SqlControlAdapterDescriptor,
  SqlControlExtensionDescriptor,
} from './migrations/types';
import { verifySqlSchema } from './schema-verify/verify-sql-schema';
import { collectSupportedCodecTypeIds, readMarker } from './verify';

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
          const columns = table.columns as Record<string, { codecId: string } | undefined>;
          for (const column of Object.values(columns)) {
            if (
              column &&
              typeof column === 'object' &&
              'codecId' in column &&
              typeof column.codecId === 'string'
            ) {
              typeIds.add(column.codecId);
            }
          }
        }
      }
    }
  }

  return Array.from(typeIds).sort();
}

function createVerifyResult(options: {
  ok: boolean;
  code?: string;
  summary: string;
  contractStorageHash: string;
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
  const contract: { storageHash: string; profileHash?: string } = {
    storageHash: options.contractStorageHash,
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
    (result as { marker?: { storageHash: string; profileHash: string } }).marker = {
      storageHash: options.marker.storageHash,
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

interface SqlTypeMetadata {
  readonly typeId: string;
  readonly familyId: 'sql';
  readonly targetId: string;
  readonly nativeType?: string;
}

type SqlTypeMetadataRegistry = Map<string, SqlTypeMetadata>;

interface SqlFamilyInstanceState {
  readonly operationRegistry: OperationRegistry;
  readonly codecTypeImports: ReadonlyArray<TypesImportSpec>;
  readonly operationTypeImports: ReadonlyArray<TypesImportSpec>;
  readonly extensionIds: ReadonlyArray<string>;
  readonly typeMetadataRegistry: SqlTypeMetadataRegistry;
}

export interface SchemaVerifyOptions {
  readonly driver: ControlDriverInstance<'sql', string>;
  readonly contractIR: unknown;
  readonly strict: boolean;
  readonly context?: OperationContext;
  /**
   * Active framework components participating in this composition.
   * All components must have matching familyId ('sql') and targetId.
   */
  readonly frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<'sql', string>>;
}

export interface SqlControlFamilyInstance
  extends ControlFamilyInstance<'sql'>,
    SqlFamilyInstanceState {
  validateContractIR(contractJson: unknown): ContractIR;

  verify(options: {
    readonly driver: ControlDriverInstance<'sql', string>;
    readonly contractIR: unknown;
    readonly expectedTargetId: string;
    readonly contractPath: string;
    readonly configPath?: string;
  }): Promise<VerifyDatabaseResult>;

  schemaVerify(options: SchemaVerifyOptions): Promise<VerifyDatabaseSchemaResult>;

  sign(options: {
    readonly driver: ControlDriverInstance<'sql', string>;
    readonly contractIR: unknown;
    readonly contractPath: string;
    readonly configPath?: string;
  }): Promise<SignDatabaseResult>;

  introspect(options: {
    readonly driver: ControlDriverInstance<'sql', string>;
    readonly contractIR?: unknown;
  }): Promise<SqlSchemaIR>;

  toSchemaView(schema: SqlSchemaIR): CoreSchemaView;

  emitContract(options: { readonly contractIR: ContractIR | unknown }): Promise<EmitContractResult>;
}

export type SqlFamilyInstance = SqlControlFamilyInstance;

interface CreateSqlFamilyInstanceOptions<TTargetId extends string> {
  readonly target: TargetDescriptor<'sql', TTargetId> &
    SqlControlDescriptorWithContributions &
    DescriptorWithStorageTypes;
  readonly adapter: SqlControlAdapterDescriptor<TTargetId> & DescriptorWithStorageTypes;
  readonly extensionPacks: readonly (SqlControlExtensionDescriptor<TTargetId> &
    DescriptorWithStorageTypes)[];
}

function isSqlControlAdapter<TTargetId extends string>(
  value: unknown,
): value is SqlControlAdapter<TTargetId> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'introspect' in value &&
    typeof (value as { introspect: unknown }).introspect === 'function'
  );
}

interface DescriptorWithStorageTypes {
  readonly targetId?: string | undefined;
  readonly types?:
    | {
        readonly storage?:
          | ReadonlyArray<{
              readonly typeId: string;
              readonly familyId: string;
              readonly targetId: string;
              readonly nativeType?: string | undefined;
            }>
          | undefined;
      }
    | undefined;
}

function buildSqlTypeMetadataRegistry(options: {
  readonly target: DescriptorWithStorageTypes;
  readonly adapter: DescriptorWithStorageTypes & { readonly targetId: string };
  readonly extensionPacks: readonly DescriptorWithStorageTypes[];
}): SqlTypeMetadataRegistry {
  const { target, adapter, extensionPacks: extensions } = options;
  const registry = new Map<string, SqlTypeMetadata>();
  const targetId = adapter.targetId;
  const descriptors = [target, adapter, ...extensions];

  for (const descriptor of descriptors) {
    const types = descriptor.types;
    const storageTypes = types?.storage;

    if (!storageTypes) {
      continue;
    }

    for (const storageType of storageTypes) {
      if (storageType.familyId === 'sql' && storageType.targetId === targetId) {
        registry.set(storageType.typeId, {
          typeId: storageType.typeId,
          familyId: 'sql',
          targetId: storageType.targetId,
          ...(storageType.nativeType !== undefined ? { nativeType: storageType.nativeType } : {}),
        });
      }
    }
  }

  return registry;
}

export function createSqlFamilyInstance<TTargetId extends string>(
  options: CreateSqlFamilyInstanceOptions<TTargetId>,
): SqlFamilyInstance {
  const { target, adapter, extensionPacks: extensions = [] } = options;

  const descriptors: SqlControlDescriptorWithContributions[] = [target, adapter, ...extensions];

  const operationRegistry = assembleOperationRegistry(descriptors);
  const codecTypeImports = extractCodecTypeImports(descriptors);
  const operationTypeImports = extractOperationTypeImports(descriptors);
  const extensionIds = extractExtensionIds(adapter, target, extensions);
  const parameterizedRenderers = extractParameterizedRenderers(descriptors);
  const parameterizedTypeImports = extractParameterizedTypeImports(descriptors);

  const typeMetadataRegistry = buildSqlTypeMetadataRegistry({
    target,
    adapter,
    extensionPacks: extensions,
  });

  function stripMappings(contract: unknown): unknown {
    if (typeof contract === 'object' && contract !== null && 'mappings' in contract) {
      const { mappings: _mappings, ...contractIR } = contract as {
        mappings?: unknown;
        [key: string]: unknown;
      };
      return contractIR;
    }
    return contract;
  }

  function normalizeProviderContractIR(contract: unknown): ContractIR {
    const contractWithoutMappings = stripMappings(contract);
    const validated = validateContract<SqlContract<SqlStorage>>(contractWithoutMappings);
    const { mappings: _mappings, ...contractIR } = validated;
    return contractIR as ContractIR;
  }

  return {
    familyId: 'sql',
    operationRegistry,
    codecTypeImports,
    operationTypeImports,
    extensionIds,
    typeMetadataRegistry,

    validateContractIR(contractJson: unknown): ContractIR {
      return normalizeProviderContractIR(contractJson);
    },

    async verify(verifyOptions: {
      readonly driver: ControlDriverInstance<'sql', string>;
      readonly contractIR: unknown;
      readonly expectedTargetId: string;
      readonly contractPath: string;
      readonly configPath?: string;
    }): Promise<VerifyDatabaseResult> {
      const { driver, contractIR, expectedTargetId, contractPath, configPath } = verifyOptions;
      const startTime = Date.now();

      if (
        typeof contractIR !== 'object' ||
        contractIR === null ||
        !('storageHash' in contractIR) ||
        !('target' in contractIR) ||
        typeof contractIR.storageHash !== 'string' ||
        typeof contractIR.target !== 'string'
      ) {
        throw new Error('Contract is missing required fields: storageHash or target');
      }

      const contractStorageHash = contractIR.storageHash;
      const contractProfileHash =
        'profileHash' in contractIR && typeof contractIR.profileHash === 'string'
          ? contractIR.profileHash
          : undefined;
      const contractTarget = contractIR.target;

      const marker = await readMarker(driver);

      let missingCodecs: readonly string[] | undefined;
      let codecCoverageSkipped = false;
      const supportedTypeIds = collectSupportedCodecTypeIds([adapter, target, ...extensions]);
      if (supportedTypeIds.length === 0) {
        codecCoverageSkipped = true;
      } else {
        const supportedSet = new Set(supportedTypeIds);
        const usedTypeIds = extractCodecTypeIdsFromContract(contractIR);
        const missing = usedTypeIds.filter((id) => !supportedSet.has(id));
        if (missing.length > 0) {
          missingCodecs = missing;
        }
      }

      if (!marker) {
        const totalTime = Date.now() - startTime;
        return createVerifyResult({
          ok: false,
          code: 'PN-RTM-3001',
          summary: 'Marker missing',
          contractStorageHash,
          expectedTargetId,
          contractPath,
          totalTime,
          ...(contractProfileHash ? { contractProfileHash } : {}),
          ...(missingCodecs ? { missingCodecs } : {}),
          ...(codecCoverageSkipped ? { codecCoverageSkipped } : {}),
          ...(configPath ? { configPath } : {}),
        });
      }

      if (contractTarget !== expectedTargetId) {
        const totalTime = Date.now() - startTime;
        return createVerifyResult({
          ok: false,
          code: 'PN-RTM-3003',
          summary: 'Target mismatch',
          contractStorageHash,
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

      if (marker.storageHash !== contractStorageHash) {
        const totalTime = Date.now() - startTime;
        return createVerifyResult({
          ok: false,
          code: 'PN-RTM-3002',
          summary: 'Hash mismatch',
          contractStorageHash,
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

      if (contractProfileHash && marker.profileHash !== contractProfileHash) {
        const totalTime = Date.now() - startTime;
        return createVerifyResult({
          ok: false,
          code: 'PN-RTM-3002',
          summary: 'Hash mismatch',
          contractStorageHash,
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

      const totalTime = Date.now() - startTime;
      return createVerifyResult({
        ok: true,
        summary: 'Database matches contract',
        contractStorageHash,
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

    async schemaVerify(options: SchemaVerifyOptions): Promise<VerifyDatabaseSchemaResult> {
      const { driver, contractIR, strict, context, frameworkComponents } = options;

      const contract = validateContract<SqlContract<SqlStorage>>(contractIR);

      const controlAdapter = adapter.create();
      if (!isSqlControlAdapter(controlAdapter)) {
        throw new Error('Adapter does not implement SqlControlAdapter.introspect()');
      }
      const schemaIR = await controlAdapter.introspect(driver, contractIR);

      return verifySqlSchema({
        contract,
        schema: schemaIR,
        strict,
        ...ifDefined('context', context),
        typeMetadataRegistry,
        frameworkComponents,
        // Wire up target-specific normalizers if available
        ...ifDefined('normalizeDefault', controlAdapter.normalizeDefault),
        ...ifDefined('normalizeNativeType', controlAdapter.normalizeNativeType),
      });
    },
    async sign(options: {
      readonly driver: ControlDriverInstance<'sql', string>;
      readonly contractIR: unknown;
      readonly contractPath: string;
      readonly configPath?: string;
    }): Promise<SignDatabaseResult> {
      const { driver, contractIR, contractPath, configPath } = options;
      const startTime = Date.now();

      const contract = validateContract<SqlContract<SqlStorage>>(contractIR);

      const contractStorageHash = contract.storageHash;
      const contractProfileHash =
        'profileHash' in contract && typeof contract.profileHash === 'string'
          ? contract.profileHash
          : contractStorageHash;
      const contractTarget = contract.target;

      await driver.query(ensureSchemaStatement.sql, ensureSchemaStatement.params);
      await driver.query(ensureTableStatement.sql, ensureTableStatement.params);

      const existingMarker = await readMarker(driver);

      let markerCreated = false;
      let markerUpdated = false;
      let previousHashes: { storageHash?: string; profileHash?: string } | undefined;

      if (!existingMarker) {
        const write = writeContractMarker({
          storageHash: contractStorageHash,
          profileHash: contractProfileHash,
          contractJson: contractIR,
          canonicalVersion: 1,
        });
        await driver.query(write.insert.sql, write.insert.params);
        markerCreated = true;
      } else {
        const existingStorageHash = existingMarker.storageHash;
        const existingProfileHash = existingMarker.profileHash;

        const storageHashMatches = existingStorageHash === contractStorageHash;
        const profileHashMatches = existingProfileHash === contractProfileHash;

        if (!storageHashMatches || !profileHashMatches) {
          previousHashes = {
            storageHash: existingStorageHash,
            profileHash: existingProfileHash,
          };
          const write = writeContractMarker({
            storageHash: contractStorageHash,
            profileHash: contractProfileHash,
            contractJson: contractIR,
            canonicalVersion: existingMarker.canonicalVersion ?? 1,
          });
          await driver.query(write.update.sql, write.update.params);
          markerUpdated = true;
        }
      }

      let summary: string;
      if (markerCreated) {
        summary = 'Database signed (marker created)';
      } else if (markerUpdated) {
        summary = `Database signed (marker updated from ${previousHashes?.storageHash ?? 'unknown'})`;
      } else {
        summary = 'Database already signed with this contract';
      }

      const totalTime = Date.now() - startTime;

      return {
        ok: true,
        summary,
        contract: {
          storageHash: contractStorageHash,
          profileHash: contractProfileHash,
        },
        target: {
          expected: contractTarget,
          actual: contractTarget,
        },
        marker: {
          created: markerCreated,
          updated: markerUpdated,
          ...(previousHashes ? { previous: previousHashes } : {}),
        },
        meta: {
          contractPath,
          ...(configPath ? { configPath } : {}),
        },
        timings: {
          total: totalTime,
        },
      };
    },
    async readMarker(options: {
      readonly driver: ControlDriverInstance<'sql', string>;
    }): Promise<ContractMarkerRecord | null> {
      return readMarker(options.driver);
    },
    async introspect(options: {
      readonly driver: ControlDriverInstance<'sql', string>;
      readonly contractIR?: unknown;
    }): Promise<SqlSchemaIR> {
      const { driver, contractIR } = options;

      const controlAdapter = adapter.create();
      if (!isSqlControlAdapter(controlAdapter)) {
        throw new Error('Adapter does not implement SqlControlAdapter.introspect()');
      }
      return controlAdapter.introspect(driver, contractIR);
    },

    toSchemaView(schema: SqlSchemaIR): CoreSchemaView {
      const rootLabel = 'contract';

      const tableNodes: readonly SchemaTreeNode[] = Object.entries(schema.tables).map(
        ([tableName, table]: [string, SqlTableIR]) => {
          const children: SchemaTreeNode[] = [];

          const columnNodes: SchemaTreeNode[] = [];
          for (const [columnName, column] of Object.entries(table.columns)) {
            const typeDisplay = column.nativeType;
            const nullability = column.nullable ? 'nullable' : 'not nullable';
            const label = `${columnName}: ${typeDisplay} (${nullability})`;
            columnNodes.push({
              kind: 'field',
              id: `column-${tableName}-${columnName}`,
              label,
              meta: {
                nativeType: column.nativeType,
                nullable: column.nullable,
                ...ifDefined('default', column.default),
              },
            });
          }

          if (columnNodes.length > 0) {
            children.push({
              kind: 'collection',
              id: `columns-${tableName}`,
              label: 'columns',
              children: columnNodes,
            });
          }

          if (table.primaryKey) {
            const pkColumns = table.primaryKey.columns.join(', ');
            children.push({
              kind: 'index',
              id: `primary-key-${tableName}`,
              label: `primary key: ${pkColumns}`,
              meta: {
                columns: table.primaryKey.columns,
                ...(table.primaryKey.name ? { name: table.primaryKey.name } : {}),
              },
            });
          }

          for (const unique of table.uniques) {
            const name = unique.name ?? `${tableName}_${unique.columns.join('_')}_unique`;
            const label = `unique ${name}`;
            children.push({
              kind: 'index',
              id: `unique-${tableName}-${name}`,
              label,
              meta: {
                columns: unique.columns,
                unique: true,
              },
            });
          }

          for (const index of table.indexes) {
            const name = index.name ?? `${tableName}_${index.columns.join('_')}_idx`;
            const label = index.unique ? `unique index ${name}` : `index ${name}`;
            children.push({
              kind: 'index',
              id: `index-${tableName}-${name}`,
              label,
              meta: {
                columns: index.columns,
                unique: index.unique,
              },
            });
          }

          const tableMeta: Record<string, unknown> = {};
          if (table.primaryKey) {
            tableMeta['primaryKey'] = table.primaryKey.columns;
            if (table.primaryKey.name) {
              tableMeta['primaryKeyName'] = table.primaryKey.name;
            }
          }
          if (table.foreignKeys.length > 0) {
            tableMeta['foreignKeys'] = table.foreignKeys.map((fk) => ({
              columns: fk.columns,
              referencedTable: fk.referencedTable,
              referencedColumns: fk.referencedColumns,
              ...(fk.name ? { name: fk.name } : {}),
            }));
          }

          const node: SchemaTreeNode = {
            kind: 'entity',
            id: `table-${tableName}`,
            label: `table ${tableName}`,
            ...(Object.keys(tableMeta).length > 0 ? { meta: tableMeta } : {}),
            ...(children.length > 0 ? { children: children as readonly SchemaTreeNode[] } : {}),
          };
          return node;
        },
      );

      const dependencyNodes: readonly SchemaTreeNode[] = schema.dependencies.map((dep) => ({
        kind: 'extension',
        id: `dependency-${dep.id}`,
        label: `${dep.id} is enabled`,
      }));

      const rootChildren = [...tableNodes, ...dependencyNodes];

      const rootNode: SchemaTreeNode = {
        kind: 'root',
        id: 'sql-schema',
        label: rootLabel,
        ...(rootChildren.length > 0 ? { children: rootChildren } : {}),
      };

      return {
        root: rootNode,
      };
    },

    async emitContract({ contractIR }): Promise<EmitContractResult> {
      const normalizedIR = normalizeProviderContractIR(contractIR);

      const result = await emit(
        normalizedIR,
        {
          outputDir: '',
          operationRegistry,
          codecTypeImports,
          operationTypeImports,
          extensionIds,
          parameterizedRenderers,
          parameterizedTypeImports,
        },
        sqlTargetFamilyHook,
      );

      return {
        contractJson: result.contractJson,
        contractDts: result.contractDts,
        storageHash: result.storageHash,
        ...(result.executionHash ? { executionHash: result.executionHash } : {}),
        profileHash: result.profileHash,
      };
    },
  };
}
