import type { TargetBoundComponentDescriptor } from '@prisma-next/contract/framework-components';
import type { ContractIR } from '@prisma-next/contract/ir';
import type { OperationManifest } from '@prisma-next/contract/pack-manifest-types';
import type { ContractMarkerRecord, TypesImportSpec } from '@prisma-next/contract/types';
import { emit } from '@prisma-next/core-control-plane/emission';
import type { CoreSchemaView, SchemaTreeNode } from '@prisma-next/core-control-plane/schema-view';
import type {
  ControlAdapterDescriptor,
  ControlDriverInstance,
  ControlExtensionDescriptor,
  ControlFamilyInstance,
  ControlTargetDescriptor,
  EmitContractResult,
  OperationContext,
  SignDatabaseResult,
  VerifyDatabaseResult,
  VerifyDatabaseSchemaResult,
} from '@prisma-next/core-control-plane/types';
import type { OperationRegistry } from '@prisma-next/operations';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import { sqlTargetFamilyHook } from '@prisma-next/sql-contract-emitter';
import { validateContract } from '@prisma-next/sql-contract-ts/contract';
import type { SqlOperationSignature } from '@prisma-next/sql-operations';
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
} from './assembly';
import type { SqlControlAdapter } from './control-adapter';
import type { SqlControlTargetDescriptor } from './migrations/types';
import { verifySqlSchema } from './schema-verify/verify-sql-schema';
import { collectSupportedCodecTypeIds, readMarker } from './verify';

/**
 * Converts an OperationManifest (from ExtensionPackManifest) to a SqlOperationSignature.
 * This is SQL-family-specific conversion logic.
 * Used internally by instance creation and test utilities in the same package.
 */
export function convertOperationManifest(manifest: OperationManifest): SqlOperationSignature {
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
 * Type metadata for SQL storage types.
 * Maps contract storage type IDs to native database types.
 */
interface SqlTypeMetadata {
  readonly typeId: string;
  readonly familyId: 'sql';
  readonly targetId: string;
  readonly nativeType?: string;
}

/**
 * Registry mapping type IDs to their metadata.
 * Keyed by contract storage type ID (e.g., 'pg/int4@1').
 */
type SqlTypeMetadataRegistry = Map<string, SqlTypeMetadata>;

/**
 * State fields for SQL family instance that hold assembly data.
 */
interface SqlFamilyInstanceState {
  readonly operationRegistry: OperationRegistry;
  readonly codecTypeImports: ReadonlyArray<TypesImportSpec>;
  readonly operationTypeImports: ReadonlyArray<TypesImportSpec>;
  readonly extensionIds: ReadonlyArray<string>;
  readonly typeMetadataRegistry: SqlTypeMetadataRegistry;
}

/**
 * Options for schema verification.
 */
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

/**
 * SQL control family instance interface.
 * Extends ControlFamilyInstance with SQL-specific domain actions.
 */
export interface SqlControlFamilyInstance
  extends ControlFamilyInstance<'sql'>,
    SqlFamilyInstanceState {
  /**
   * Validates a contract JSON and returns a validated ContractIR (without mappings).
   * Mappings are runtime-only and should not be part of ContractIR.
   */
  validateContractIR(contractJson: unknown): ContractIR;

  /**
   * Verifies the database marker against the contract.
   * Compares target, coreHash, and profileHash.
   */
  verify(options: {
    readonly driver: ControlDriverInstance<'sql', string>;
    readonly contractIR: unknown;
    readonly expectedTargetId: string;
    readonly contractPath: string;
    readonly configPath?: string;
  }): Promise<VerifyDatabaseResult>;

  /**
   * Verifies the database schema against the contract.
   * Compares contract requirements against live database schema.
   */
  schemaVerify(options: SchemaVerifyOptions): Promise<VerifyDatabaseSchemaResult>;

  /**
   * Signs the database with the contract marker.
   * Writes or updates the contract marker if schema verification passes.
   * This operation is idempotent - if the marker already matches, no changes are made.
   */
  sign(options: {
    readonly driver: ControlDriverInstance<'sql', string>;
    readonly contractIR: unknown;
    readonly contractPath: string;
    readonly configPath?: string;
  }): Promise<SignDatabaseResult>;

  /**
   * Introspects the database schema and returns a family-specific schema IR.
   *
   * This is a read-only operation that returns a snapshot of the live database schema.
   * The method is family-owned and delegates to target/adapter-specific introspectors
   * to perform the actual schema introspection.
   *
   * @param options - Introspection options
   * @param options.driver - Control plane driver for database connection
   * @param options.contractIR - Optional contract IR for contract-guided introspection.
   *   When provided, families may use it for filtering, optimization, or validation
   *   during introspection. The contract IR does not change the meaning of "what exists"
   *   in the database - it only guides how introspection is performed.
   * @returns Promise resolving to the family-specific Schema IR (e.g., `SqlSchemaIR` for SQL).
   *   The IR represents the complete schema snapshot at the time of introspection.
   */
  introspect(options: {
    readonly driver: ControlDriverInstance<'sql', string>;
    readonly contractIR?: unknown;
  }): Promise<SqlSchemaIR>;

  /**
   * Projects a SQL Schema IR into a core schema view for CLI visualization.
   * Converts SqlSchemaIR (tables, columns, indexes, extensions) into a tree structure.
   */
  toSchemaView(schema: SqlSchemaIR): CoreSchemaView;

  /**
   * Emits contract JSON and DTS as strings.
   * Uses the instance's preassembled state (operation registry, type imports, extension IDs).
   * Handles stripping mappings and validation internally.
   */
  emitContract(options: { readonly contractIR: ContractIR | unknown }): Promise<EmitContractResult>;
}

/**
 * SQL family instance type.
 * Maintains backward compatibility with FamilyInstance while implementing SqlControlFamilyInstance.
 */
export type SqlFamilyInstance = SqlControlFamilyInstance;

interface CreateSqlFamilyInstanceOptions<
  TTargetId extends string = string,
  TTargetDetails = Record<string, never>,
> {
  readonly target: SqlControlTargetDescriptor<TTargetId, TTargetDetails>;
  readonly adapter: ControlAdapterDescriptor<'sql', string, SqlControlAdapter>;
  readonly extensions: readonly ControlExtensionDescriptor<'sql', string>[];
}

/**
 * Builds a SQL type metadata registry from extension pack manifests.
 * Collects type metadata from target, adapter, and extension pack manifests.
 *
 * @param options - Descriptors for target, adapter, and extensions
 * @returns Registry mapping type IDs to their metadata, filtered by targetId
 */
function buildSqlTypeMetadataRegistry(options: {
  readonly target: ControlTargetDescriptor<'sql', string>;
  readonly adapter: ControlAdapterDescriptor<'sql', string>;
  readonly extensions: readonly ControlExtensionDescriptor<'sql', string>[];
}): SqlTypeMetadataRegistry {
  const { target, adapter, extensions } = options;
  const registry = new Map<string, SqlTypeMetadata>();

  // Get targetId from adapter (they should match)
  const targetId = adapter.targetId;

  // Collect descriptors to iterate over
  const descriptors = [target, adapter, ...extensions];

  // Iterate over each descriptor's manifest
  for (const descriptor of descriptors) {
    const manifest = descriptor.manifest;
    const storageTypes = manifest.types?.storage;

    if (!storageTypes) {
      continue;
    }

    // Filter for SQL family and matching targetId
    for (const storageType of storageTypes) {
      if (storageType.familyId === 'sql' && storageType.targetId === targetId) {
        // Use existing entry if present, otherwise create new one
        // Later entries (extensions) can override earlier ones (adapter/target)
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

/**
 * Creates a SQL family instance for control-plane operations.
 */
export function createSqlFamilyInstance<
  TTargetId extends string = string,
  TTargetDetails = Record<string, never>,
>(options: CreateSqlFamilyInstanceOptions<TTargetId, TTargetDetails>): SqlFamilyInstance {
  const { target, adapter, extensions } = options;

  // Build descriptors array for assembly
  // Assembly functions only use manifest and id, so we can pass Control*Descriptor types directly
  const descriptors = [target, adapter, ...extensions];

  // Assemble operation registry, type imports, and extension IDs
  const operationRegistry = assembleOperationRegistry(descriptors, convertOperationManifest);
  const codecTypeImports = extractCodecTypeImports(descriptors);
  const operationTypeImports = extractOperationTypeImports(descriptors);
  const extensionIds = extractExtensionIds(adapter, target, extensions);

  // Build type metadata registry from manifests
  const typeMetadataRegistry = buildSqlTypeMetadataRegistry({ target, adapter, extensions });

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
    typeMetadataRegistry,

    validateContractIR(contractJson: unknown): ContractIR {
      // Validate the contract (this normalizes and validates structure/logic)
      const validated = validateContract<SqlContract<SqlStorage>>(contractJson);
      // Strip mappings before returning ContractIR (mappings are runtime-only)
      // The validated contract has all required ContractIR properties
      const { mappings: _mappings, ...contractIR } = validated;
      return contractIR as ContractIR;
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
      const supportedTypeIds = collectSupportedCodecTypeIds<'sql', string>([
        adapter,
        target,
        ...extensions,
      ]);
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

    async schemaVerify(options: SchemaVerifyOptions): Promise<VerifyDatabaseSchemaResult> {
      const { driver, contractIR, strict, context, frameworkComponents } = options;

      // Validate contractIR as SqlContract<SqlStorage>
      const contract = validateContract<SqlContract<SqlStorage>>(contractIR);

      // Introspect live schema (DB I/O)
      const controlAdapter = adapter.create();
      const schemaIR = await controlAdapter.introspect(driver, contractIR);

      // Pure verification (no I/O) - delegates to extracted pure function
      return verifySqlSchema({
        contract,
        schema: schemaIR,
        strict,
        ...ifDefined('context', context),
        typeMetadataRegistry,
        frameworkComponents,
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

      // Validate contractIR as SqlContract<SqlStorage>
      const contract = validateContract<SqlContract<SqlStorage>>(contractIR);

      // Extract contract hashes and target
      const contractCoreHash = contract.coreHash;
      const contractProfileHash =
        'profileHash' in contract && typeof contract.profileHash === 'string'
          ? contract.profileHash
          : contractCoreHash;
      const contractTarget = contract.target;

      // Ensure marker schema and table exist
      await driver.query(ensureSchemaStatement.sql, ensureSchemaStatement.params);
      await driver.query(ensureTableStatement.sql, ensureTableStatement.params);

      // Read existing marker
      const existingMarker = await readMarker(driver);

      // Determine if we need to write/update marker
      let markerCreated = false;
      let markerUpdated = false;
      let previousHashes: { coreHash?: string; profileHash?: string } | undefined;

      if (!existingMarker) {
        // No marker exists - insert new one
        const write = writeContractMarker({
          coreHash: contractCoreHash,
          profileHash: contractProfileHash,
          contractJson: contractIR,
          canonicalVersion: 1,
        });
        await driver.query(write.insert.sql, write.insert.params);
        markerCreated = true;
      } else {
        // Marker exists - check if hashes differ
        const existingCoreHash = existingMarker.coreHash;
        const existingProfileHash = existingMarker.profileHash;

        // Compare hashes (use strict equality to ensure exact match)
        const coreHashMatches = existingCoreHash === contractCoreHash;
        const profileHashMatches = existingProfileHash === contractProfileHash;

        if (!coreHashMatches || !profileHashMatches) {
          // Hashes differ - update marker and capture previous hashes for output
          previousHashes = {
            coreHash: existingCoreHash,
            profileHash: existingProfileHash,
          };
          const write = writeContractMarker({
            coreHash: contractCoreHash,
            profileHash: contractProfileHash,
            contractJson: contractIR,
            canonicalVersion: existingMarker.canonicalVersion ?? 1,
          });
          await driver.query(write.update.sql, write.update.params);
          markerUpdated = true;
        }
        // If hashes match, no-op (idempotent) - previousHashes remains undefined
      }

      // Build summary message
      let summary: string;
      if (markerCreated) {
        summary = 'Database signed (marker created)';
      } else if (markerUpdated) {
        summary = `Database signed (marker updated from ${previousHashes?.coreHash ?? 'unknown'})`;
      } else {
        summary = 'Database already signed with this contract';
      }

      const totalTime = Date.now() - startTime;

      return {
        ok: true,
        summary,
        contract: {
          coreHash: contractCoreHash,
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
    async introspect(options: {
      readonly driver: ControlDriverInstance<'sql', string>;
      readonly contractIR?: unknown;
    }): Promise<SqlSchemaIR> {
      const { driver, contractIR } = options;

      const controlAdapter = adapter.create();
      return controlAdapter.introspect(driver, contractIR);
    },

    toSchemaView(schema: SqlSchemaIR): CoreSchemaView {
      const rootLabel = 'contract';

      // Build table nodes
      const tableNodes: readonly SchemaTreeNode[] = Object.entries(schema.tables).map(
        ([tableName, table]: [string, SqlTableIR]) => {
          const children: SchemaTreeNode[] = [];

          // Add column nodes grouped under "columns"
          const columnNodes: SchemaTreeNode[] = [];
          for (const [columnName, column] of Object.entries(table.columns)) {
            const nullableText = column.nullable ? '(nullable)' : '(not nullable)';
            // Always display nativeType for introspection (database state)
            const typeDisplay = column.nativeType;
            const label = `${columnName}: ${typeDisplay} ${nullableText}`;
            columnNodes.push({
              kind: 'field',
              id: `column-${tableName}-${columnName}`,
              label,
              meta: {
                nativeType: column.nativeType,
                nullable: column.nullable,
              },
            });
          }

          // Add "columns" grouping node if there are columns
          if (columnNodes.length > 0) {
            children.push({
              kind: 'collection',
              id: `columns-${tableName}`,
              label: 'columns',
              children: columnNodes,
            });
          }

          // Add primary key node if present
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

          // Add unique constraint nodes
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

          // Add index nodes
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

          // Build table meta
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

      // Add extension nodes (format: "extensionName extension is enabled")
      const extensionNodes: readonly SchemaTreeNode[] = schema.extensions.map((extName) => ({
        kind: 'extension',
        id: `extension-${extName}`,
        label: `${extName} extension is enabled`,
      }));

      // Combine all children
      const rootChildren = [...tableNodes, ...extensionNodes];

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
      // Strip mappings if present (mappings are runtime-only)
      const contractWithoutMappings = stripMappings(contractIR);

      // Validate and normalize the contract
      const validatedIR = this.validateContractIR(contractWithoutMappings);

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
