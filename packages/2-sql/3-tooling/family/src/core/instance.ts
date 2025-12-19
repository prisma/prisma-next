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
  SchemaIssue,
  SchemaVerificationNode,
  SignDatabaseResult,
  VerifyDatabaseResult,
  VerifyDatabaseSchemaResult,
} from '@prisma-next/core-control-plane/types';
import type { OperationRegistry } from '@prisma-next/operations';
import type {
  ForeignKey,
  Index,
  PrimaryKey,
  SqlContract,
  SqlStorage,
  UniqueConstraint,
} from '@prisma-next/sql-contract/types';
import { sqlTargetFamilyHook } from '@prisma-next/sql-contract-emitter';
import { validateContract } from '@prisma-next/sql-contract-ts/contract';
import type { SqlOperationSignature } from '@prisma-next/sql-operations';
import {
  ensureSchemaStatement,
  ensureTableStatement,
  writeContractMarker,
} from '@prisma-next/sql-runtime';
import type {
  SqlForeignKeyIR,
  SqlIndexIR,
  SqlSchemaIR,
  SqlTableIR,
  SqlUniqueIR,
} from '@prisma-next/sql-schema-ir/types';
import {
  assembleOperationRegistry,
  extractCodecTypeImports,
  extractExtensionIds,
  extractOperationTypeImports,
} from './assembly';
import type { SqlControlAdapter } from './control-adapter';
import type { SqlControlTargetDescriptor } from './migrations/types';
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
 * Compares two arrays of strings for equality (order-sensitive).
 */
function arraysEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

/**
 * Compares primary keys and adds issues if mismatch.
 * Returns 'pass' or 'fail'.
 */
function comparePrimaryKey(
  contractPK: PrimaryKey,
  schemaPK: PrimaryKey | undefined,
  tableName: string,
  issues: SchemaIssue[],
): 'pass' | 'fail' {
  if (!schemaPK) {
    issues.push({
      kind: 'primary_key_mismatch',
      table: tableName,
      expected: contractPK.columns.join(', '),
      message: `Table "${tableName}" is missing primary key`,
    });
    return 'fail';
  }

  if (!arraysEqual(contractPK.columns, schemaPK.columns)) {
    issues.push({
      kind: 'primary_key_mismatch',
      table: tableName,
      expected: contractPK.columns.join(', '),
      actual: schemaPK.columns.join(', '),
      message: `Table "${tableName}" has primary key mismatch: expected columns [${contractPK.columns.join(', ')}], got [${schemaPK.columns.join(', ')}]`,
    });
    return 'fail';
  }

  // Compare name if both are modeled
  if (contractPK.name && schemaPK.name && contractPK.name !== schemaPK.name) {
    issues.push({
      kind: 'primary_key_mismatch',
      table: tableName,
      indexOrConstraint: contractPK.name,
      expected: contractPK.name,
      actual: schemaPK.name,
      message: `Table "${tableName}" has primary key name mismatch: expected "${contractPK.name}", got "${schemaPK.name}"`,
    });
    return 'fail';
  }

  return 'pass';
}

/**
 * Compares foreign keys and returns verification nodes.
 */
function compareForeignKeys(
  contractFKs: readonly ForeignKey[],
  schemaFKs: readonly SqlForeignKeyIR[],
  tableName: string,
  tablePath: string,
  issues: SchemaIssue[],
  strict: boolean,
): SchemaVerificationNode[] {
  const nodes: SchemaVerificationNode[] = [];

  // Check each contract FK exists in schema
  for (const contractFK of contractFKs) {
    const fkPath = `${tablePath}.foreignKeys[${contractFK.columns.join(',')}]`;
    const matchingFK = schemaFKs.find((fk) => {
      return (
        arraysEqual(fk.columns, contractFK.columns) &&
        fk.referencedTable === contractFK.references.table &&
        arraysEqual(fk.referencedColumns, contractFK.references.columns)
      );
    });

    if (!matchingFK) {
      issues.push({
        kind: 'foreign_key_mismatch',
        table: tableName,
        expected: `${contractFK.columns.join(', ')} -> ${contractFK.references.table}(${contractFK.references.columns.join(', ')})`,
        message: `Table "${tableName}" is missing foreign key: ${contractFK.columns.join(', ')} -> ${contractFK.references.table}(${contractFK.references.columns.join(', ')})`,
      });
      nodes.push({
        status: 'fail',
        kind: 'foreignKey',
        name: `foreignKey(${contractFK.columns.join(', ')})`,
        contractPath: fkPath,
        code: 'foreign_key_mismatch',
        message: 'Foreign key missing',
        expected: contractFK,
        actual: undefined,
        children: [],
      });
    } else {
      // Compare name if both are modeled
      if (contractFK.name && matchingFK.name && contractFK.name !== matchingFK.name) {
        issues.push({
          kind: 'foreign_key_mismatch',
          table: tableName,
          indexOrConstraint: contractFK.name,
          expected: contractFK.name,
          actual: matchingFK.name,
          message: `Table "${tableName}" has foreign key name mismatch: expected "${contractFK.name}", got "${matchingFK.name}"`,
        });
        nodes.push({
          status: 'fail',
          kind: 'foreignKey',
          name: `foreignKey(${contractFK.columns.join(', ')})`,
          contractPath: fkPath,
          code: 'foreign_key_mismatch',
          message: 'Foreign key name mismatch',
          expected: contractFK.name,
          actual: matchingFK.name,
          children: [],
        });
      } else {
        nodes.push({
          status: 'pass',
          kind: 'foreignKey',
          name: `foreignKey(${contractFK.columns.join(', ')})`,
          contractPath: fkPath,
          code: '',
          message: '',
          expected: undefined,
          actual: undefined,
          children: [],
        });
      }
    }
  }

  // Check for extra FKs in strict mode
  if (strict) {
    for (const schemaFK of schemaFKs) {
      const matchingFK = contractFKs.find((fk) => {
        return (
          arraysEqual(fk.columns, schemaFK.columns) &&
          fk.references.table === schemaFK.referencedTable &&
          arraysEqual(fk.references.columns, schemaFK.referencedColumns)
        );
      });

      if (!matchingFK) {
        issues.push({
          kind: 'foreign_key_mismatch',
          table: tableName,
          message: `Extra foreign key found in database (not in contract): ${schemaFK.columns.join(', ')} -> ${schemaFK.referencedTable}(${schemaFK.referencedColumns.join(', ')})`,
        });
        nodes.push({
          status: 'fail',
          kind: 'foreignKey',
          name: `foreignKey(${schemaFK.columns.join(', ')})`,
          contractPath: `${tablePath}.foreignKeys[${schemaFK.columns.join(',')}]`,
          code: 'extra_foreign_key',
          message: 'Extra foreign key found',
          expected: undefined,
          actual: schemaFK,
          children: [],
        });
      }
    }
  }

  return nodes;
}

/**
 * Compares unique constraints and returns verification nodes.
 */
function compareUniqueConstraints(
  contractUniques: readonly UniqueConstraint[],
  schemaUniques: readonly SqlUniqueIR[],
  tableName: string,
  tablePath: string,
  issues: SchemaIssue[],
  strict: boolean,
): SchemaVerificationNode[] {
  const nodes: SchemaVerificationNode[] = [];

  // Check each contract unique exists in schema
  for (const contractUnique of contractUniques) {
    const uniquePath = `${tablePath}.uniques[${contractUnique.columns.join(',')}]`;
    const matchingUnique = schemaUniques.find((u) =>
      arraysEqual(u.columns, contractUnique.columns),
    );

    if (!matchingUnique) {
      issues.push({
        kind: 'unique_constraint_mismatch',
        table: tableName,
        expected: contractUnique.columns.join(', '),
        message: `Table "${tableName}" is missing unique constraint: ${contractUnique.columns.join(', ')}`,
      });
      nodes.push({
        status: 'fail',
        kind: 'unique',
        name: `unique(${contractUnique.columns.join(', ')})`,
        contractPath: uniquePath,
        code: 'unique_constraint_mismatch',
        message: 'Unique constraint missing',
        expected: contractUnique,
        actual: undefined,
        children: [],
      });
    } else {
      // Compare name if both are modeled
      if (
        contractUnique.name &&
        matchingUnique.name &&
        contractUnique.name !== matchingUnique.name
      ) {
        issues.push({
          kind: 'unique_constraint_mismatch',
          table: tableName,
          indexOrConstraint: contractUnique.name,
          expected: contractUnique.name,
          actual: matchingUnique.name,
          message: `Table "${tableName}" has unique constraint name mismatch: expected "${contractUnique.name}", got "${matchingUnique.name}"`,
        });
        nodes.push({
          status: 'fail',
          kind: 'unique',
          name: `unique(${contractUnique.columns.join(', ')})`,
          contractPath: uniquePath,
          code: 'unique_constraint_mismatch',
          message: 'Unique constraint name mismatch',
          expected: contractUnique.name,
          actual: matchingUnique.name,
          children: [],
        });
      } else {
        nodes.push({
          status: 'pass',
          kind: 'unique',
          name: `unique(${contractUnique.columns.join(', ')})`,
          contractPath: uniquePath,
          code: '',
          message: '',
          expected: undefined,
          actual: undefined,
          children: [],
        });
      }
    }
  }

  // Check for extra uniques in strict mode
  if (strict) {
    for (const schemaUnique of schemaUniques) {
      const matchingUnique = contractUniques.find((u) =>
        arraysEqual(u.columns, schemaUnique.columns),
      );

      if (!matchingUnique) {
        issues.push({
          kind: 'unique_constraint_mismatch',
          table: tableName,
          message: `Extra unique constraint found in database (not in contract): ${schemaUnique.columns.join(', ')}`,
        });
        nodes.push({
          status: 'fail',
          kind: 'unique',
          name: `unique(${schemaUnique.columns.join(', ')})`,
          contractPath: `${tablePath}.uniques[${schemaUnique.columns.join(',')}]`,
          code: 'extra_unique_constraint',
          message: 'Extra unique constraint found',
          expected: undefined,
          actual: schemaUnique,
          children: [],
        });
      }
    }
  }

  return nodes;
}

/**
 * Compares indexes and returns verification nodes.
 */
function compareIndexes(
  contractIndexes: readonly Index[],
  schemaIndexes: readonly SqlIndexIR[],
  tableName: string,
  tablePath: string,
  issues: SchemaIssue[],
  strict: boolean,
): SchemaVerificationNode[] {
  const nodes: SchemaVerificationNode[] = [];

  // Check each contract index exists in schema
  for (const contractIndex of contractIndexes) {
    const indexPath = `${tablePath}.indexes[${contractIndex.columns.join(',')}]`;
    const matchingIndex = schemaIndexes.find(
      (idx) => arraysEqual(idx.columns, contractIndex.columns) && idx.unique === false,
    );

    if (!matchingIndex) {
      issues.push({
        kind: 'index_mismatch',
        table: tableName,
        expected: contractIndex.columns.join(', '),
        message: `Table "${tableName}" is missing index: ${contractIndex.columns.join(', ')}`,
      });
      nodes.push({
        status: 'fail',
        kind: 'index',
        name: `index(${contractIndex.columns.join(', ')})`,
        contractPath: indexPath,
        code: 'index_mismatch',
        message: 'Index missing',
        expected: contractIndex,
        actual: undefined,
        children: [],
      });
    } else {
      // Compare name if both are modeled
      if (contractIndex.name && matchingIndex.name && contractIndex.name !== matchingIndex.name) {
        issues.push({
          kind: 'index_mismatch',
          table: tableName,
          indexOrConstraint: contractIndex.name,
          expected: contractIndex.name,
          actual: matchingIndex.name,
          message: `Table "${tableName}" has index name mismatch: expected "${contractIndex.name}", got "${matchingIndex.name}"`,
        });
        nodes.push({
          status: 'fail',
          kind: 'index',
          name: `index(${contractIndex.columns.join(', ')})`,
          contractPath: indexPath,
          code: 'index_mismatch',
          message: 'Index name mismatch',
          expected: contractIndex.name,
          actual: matchingIndex.name,
          children: [],
        });
      } else {
        nodes.push({
          status: 'pass',
          kind: 'index',
          name: `index(${contractIndex.columns.join(', ')})`,
          contractPath: indexPath,
          code: '',
          message: '',
          expected: undefined,
          actual: undefined,
          children: [],
        });
      }
    }
  }

  // Check for extra indexes in strict mode
  if (strict) {
    for (const schemaIndex of schemaIndexes) {
      // Skip unique indexes (they're handled as unique constraints)
      if (schemaIndex.unique) {
        continue;
      }

      const matchingIndex = contractIndexes.find((idx) =>
        arraysEqual(idx.columns, schemaIndex.columns),
      );

      if (!matchingIndex) {
        issues.push({
          kind: 'index_mismatch',
          table: tableName,
          message: `Extra index found in database (not in contract): ${schemaIndex.columns.join(', ')}`,
        });
        nodes.push({
          status: 'fail',
          kind: 'index',
          name: `index(${schemaIndex.columns.join(', ')})`,
          contractPath: `${tablePath}.indexes[${schemaIndex.columns.join(',')}]`,
          code: 'extra_index',
          message: 'Extra index found',
          expected: undefined,
          actual: schemaIndex,
          children: [],
        });
      }
    }
  }

  return nodes;
}

/**
 * Compares extensions and returns verification nodes.
 * Extracts extension names from contract.extensions (keys) and compares with schemaIR.extensions.
 * Filters out the target name (e.g., 'postgres') as it's not an extension.
 */
function compareExtensions(
  contractExtensions: Record<string, unknown> | undefined,
  schemaExtensions: readonly string[],
  contractTarget: string,
  issues: SchemaIssue[],
  _strict: boolean,
): SchemaVerificationNode[] {
  const nodes: SchemaVerificationNode[] = [];

  if (!contractExtensions) {
    return nodes;
  }

  // Extract extension names from contract (keys of extensions object)
  // Filter out the target name - it's not an extension (e.g., 'postgres' is the target, not an extension)
  const contractExtensionNames = Object.keys(contractExtensions).filter(
    (name) => name !== contractTarget,
  );

  // Check each contract extension exists in schema
  // Extension names in contract may differ from database extension names
  // (e.g., contract has 'pgvector' but database has 'vector')
  // We need to match more flexibly - try exact match, then check if either contains the other
  for (const extName of contractExtensionNames) {
    const extPath = `extensions.${extName}`;
    // Normalize extension names for comparison (remove common prefixes like 'pg')
    const normalizedExtName = extName.toLowerCase().replace(/^pg/, '');
    const matchingExt = schemaExtensions.find((e) => {
      const normalizedE = e.toLowerCase();
      // Exact match
      if (normalizedE === normalizedExtName || normalizedE === extName.toLowerCase()) {
        return true;
      }
      // Check if one contains the other (e.g., 'pgvector' contains 'vector', 'vector' is in 'pgvector')
      if (normalizedE.includes(normalizedExtName) || normalizedExtName.includes(normalizedE)) {
        return true;
      }
      return false;
    });

    // Map extension names to descriptive labels
    const extensionLabels: Record<string, string> = {
      pg: 'database is postgres',
      pgvector: 'vector extension is enabled',
      vector: 'vector extension is enabled',
    };
    const extensionLabel = extensionLabels[extName] ?? `extension "${extName}" is enabled`;

    if (!matchingExt) {
      issues.push({
        kind: 'extension_missing',
        table: '',
        message: `Extension "${extName}" is missing from database`,
      });
      nodes.push({
        status: 'fail',
        kind: 'extension',
        name: extensionLabel,
        contractPath: extPath,
        code: 'extension_missing',
        message: `Extension "${extName}" is missing`,
        expected: undefined,
        actual: undefined,
        children: [],
      });
    } else {
      nodes.push({
        status: 'pass',
        kind: 'extension',
        name: extensionLabel,
        contractPath: extPath,
        code: '',
        message: '',
        expected: undefined,
        actual: undefined,
        children: [],
      });
    }
  }

  // In strict mode, we don't check for extra extensions (they're allowed)
  // Extensions are additive - having extra extensions doesn't break the contract

  return nodes;
}

/**
 * Computes counts of pass/warn/fail nodes by traversing the tree.
 */
function computeCounts(node: SchemaVerificationNode): {
  pass: number;
  warn: number;
  fail: number;
  totalNodes: number;
} {
  let pass = 0;
  let warn = 0;
  let fail = 0;

  function traverse(n: SchemaVerificationNode): void {
    if (n.status === 'pass') {
      pass++;
    } else if (n.status === 'warn') {
      warn++;
    } else if (n.status === 'fail') {
      fail++;
    }

    if (n.children) {
      for (const child of n.children) {
        traverse(child);
      }
    }
  }

  traverse(node);

  return {
    pass,
    warn,
    fail,
    totalNodes: pass + warn + fail,
  };
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
  validateContractIR(contractJson: unknown): unknown;

  /**
   * Verifies the database marker against the contract.
   * Compares target, coreHash, and profileHash.
   */
  verify(options: {
    readonly driver: ControlDriverInstance;
    readonly contractIR: unknown;
    readonly expectedTargetId: string;
    readonly contractPath: string;
    readonly configPath?: string;
  }): Promise<VerifyDatabaseResult>;

  /**
   * Verifies the database schema against the contract.
   * Compares contract requirements against live database schema.
   */
  schemaVerify(options: {
    readonly driver: ControlDriverInstance;
    readonly contractIR: unknown;
    readonly strict: boolean;
    readonly contractPath: string;
    readonly configPath?: string;
  }): Promise<VerifyDatabaseSchemaResult>;

  /**
   * Signs the database with the contract marker.
   * Writes or updates the contract marker if schema verification passes.
   * This operation is idempotent - if the marker already matches, no changes are made.
   */
  sign(options: {
    readonly driver: ControlDriverInstance;
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
    readonly driver: ControlDriverInstance;
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

interface CreateSqlFamilyInstanceOptions<TTargetId extends string = string> {
  readonly target: SqlControlTargetDescriptor<TTargetId>;
  readonly adapter: ControlAdapterDescriptor<'sql', string>;
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
export function createSqlFamilyInstance<TTargetId extends string = string>(
  options: CreateSqlFamilyInstanceOptions<TTargetId>,
): SqlFamilyInstance {
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

    validateContractIR(contractJson: unknown): unknown {
      // Validate the contract (this normalizes and validates structure/logic)
      const validated = validateContract<SqlContract<SqlStorage>>(contractJson);
      // Strip mappings before returning ContractIR (mappings are runtime-only)
      const { mappings: _mappings, ...contractIR } = validated;
      return contractIR;
    },

    async verify(verifyOptions: {
      readonly driver: ControlDriverInstance;
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

    async schemaVerify(options: {
      readonly driver: ControlDriverInstance;
      readonly contractIR: unknown;
      readonly strict: boolean;
      readonly contractPath: string;
      readonly configPath?: string;
    }): Promise<VerifyDatabaseSchemaResult> {
      const { driver, contractIR, strict, contractPath, configPath } = options;
      const startTime = Date.now();

      // Validate contractIR as SqlContract<SqlStorage>
      const contract = validateContract<SqlContract<SqlStorage>>(contractIR);

      // Extract contract hashes and target
      const contractCoreHash = contract.coreHash;
      const contractProfileHash =
        'profileHash' in contract && typeof contract.profileHash === 'string'
          ? contract.profileHash
          : undefined;
      const contractTarget = contract.target;

      // Introspect live schema
      const controlAdapter = adapter.create() as SqlControlAdapter;
      const schemaIR = await controlAdapter.introspect(
        driver as ControlDriverInstance<string>,
        contractIR,
      );

      // Compare contract vs schema IR
      const issues: SchemaIssue[] = [];
      const rootChildren: SchemaVerificationNode[] = [];

      // Compare tables
      const contractTables = contract.storage.tables;
      const schemaTables = schemaIR.tables;

      for (const [tableName, contractTable] of Object.entries(contractTables)) {
        const schemaTable = schemaTables[tableName];
        const tablePath = `storage.tables.${tableName}`;

        if (!schemaTable) {
          // Missing table
          issues.push({
            kind: 'missing_table',
            table: tableName,
            message: `Table "${tableName}" is missing from database`,
          });
          rootChildren.push({
            status: 'fail',
            kind: 'table',
            name: `table ${tableName}`,
            contractPath: tablePath,
            code: 'missing_table',
            message: `Table "${tableName}" is missing`,
            expected: undefined,
            actual: undefined,
            children: [],
          });
          continue;
        }

        // Table exists - compare columns, constraints, etc.
        const tableChildren: SchemaVerificationNode[] = [];
        const columnNodes: SchemaVerificationNode[] = [];

        // Compare columns
        for (const [columnName, contractColumn] of Object.entries(contractTable.columns)) {
          const schemaColumn = schemaTable.columns[columnName];
          const columnPath = `${tablePath}.columns.${columnName}`;

          if (!schemaColumn) {
            // Missing column
            issues.push({
              kind: 'missing_column',
              table: tableName,
              column: columnName,
              message: `Column "${tableName}"."${columnName}" is missing from database`,
            });
            columnNodes.push({
              status: 'fail',
              kind: 'column',
              name: `${columnName}: missing`,
              contractPath: columnPath,
              code: 'missing_column',
              message: `Column "${columnName}" is missing`,
              expected: undefined,
              actual: undefined,
              children: [],
            });
            continue;
          }

          // Column exists - compare type and nullability
          const columnChildren: SchemaVerificationNode[] = [];
          let columnStatus: 'pass' | 'warn' | 'fail' = 'pass';

          // Compare type using nativeType directly
          // Contract now stores nativeType directly (e.g., 'int4'), schema IR has nativeType (e.g., 'int4')
          const contractNativeType = contractColumn.nativeType;
          const schemaNativeType = schemaColumn.nativeType;

          if (!contractNativeType) {
            // Contract column doesn't have nativeType - this shouldn't happen with new contract format
            issues.push({
              kind: 'type_mismatch',
              table: tableName,
              column: columnName,
              expected: 'nativeType required',
              actual: schemaNativeType || 'unknown',
              message: `Column "${tableName}"."${columnName}" is missing nativeType in contract`,
            });
            columnChildren.push({
              status: 'fail',
              kind: 'type',
              name: 'type',
              contractPath: `${columnPath}.nativeType`,
              code: 'type_mismatch',
              message: 'Contract column is missing nativeType',
              expected: 'nativeType required',
              actual: schemaNativeType || 'unknown',
              children: [],
            });
            columnStatus = 'fail';
          } else if (!schemaNativeType) {
            // Schema IR doesn't have nativeType - this shouldn't happen
            issues.push({
              kind: 'type_mismatch',
              table: tableName,
              column: columnName,
              expected: contractNativeType,
              actual: 'unknown',
              message: `Column "${tableName}"."${columnName}" has type mismatch: schema column has no nativeType`,
            });
            columnChildren.push({
              status: 'fail',
              kind: 'type',
              name: 'type',
              contractPath: `${columnPath}.nativeType`,
              code: 'type_mismatch',
              message: 'Schema column has no nativeType',
              expected: contractNativeType,
              actual: 'unknown',
              children: [],
            });
            columnStatus = 'fail';
          } else if (contractNativeType !== schemaNativeType) {
            // Compare native types directly
            issues.push({
              kind: 'type_mismatch',
              table: tableName,
              column: columnName,
              expected: contractNativeType,
              actual: schemaNativeType,
              message: `Column "${tableName}"."${columnName}" has type mismatch: expected "${contractNativeType}", got "${schemaNativeType}"`,
            });
            columnChildren.push({
              status: 'fail',
              kind: 'type',
              name: 'type',
              contractPath: `${columnPath}.nativeType`,
              code: 'type_mismatch',
              message: `Type mismatch: expected ${contractNativeType}, got ${schemaNativeType}`,
              expected: contractNativeType,
              actual: schemaNativeType,
              children: [],
            });
            columnStatus = 'fail';
          }

          // Optionally validate that codecId (if present) and nativeType agree with registry
          if (contractColumn.codecId) {
            const typeMetadata = typeMetadataRegistry.get(contractColumn.codecId);
            if (!typeMetadata) {
              // Warning: codecId not found in registry
              columnChildren.push({
                status: 'warn',
                kind: 'type',
                name: 'type_metadata_missing',
                contractPath: `${columnPath}.codecId`,
                code: 'type_metadata_missing',
                message: `codecId "${contractColumn.codecId}" not found in type metadata registry`,
                expected: contractColumn.codecId,
                actual: undefined,
                children: [],
              });
            } else if (typeMetadata.nativeType && typeMetadata.nativeType !== contractNativeType) {
              // Warning: codecId and nativeType don't agree with registry
              columnChildren.push({
                status: 'warn',
                kind: 'type',
                name: 'type_consistency',
                contractPath: `${columnPath}.codecId`,
                code: 'type_consistency_warning',
                message: `codecId "${contractColumn.codecId}" maps to nativeType "${typeMetadata.nativeType}" in registry, but contract has "${contractNativeType}"`,
                expected: typeMetadata.nativeType,
                actual: contractNativeType,
                children: [],
              });
            }
          }

          // Compare nullability
          if (contractColumn.nullable !== schemaColumn.nullable) {
            issues.push({
              kind: 'nullability_mismatch',
              table: tableName,
              column: columnName,
              expected: String(contractColumn.nullable),
              actual: String(schemaColumn.nullable),
              message: `Column "${tableName}"."${columnName}" has nullability mismatch: expected ${contractColumn.nullable ? 'nullable' : 'not null'}, got ${schemaColumn.nullable ? 'nullable' : 'not null'}`,
            });
            columnChildren.push({
              status: 'fail',
              kind: 'nullability',
              name: 'nullability',
              contractPath: `${columnPath}.nullable`,
              code: 'nullability_mismatch',
              message: `Nullability mismatch: expected ${contractColumn.nullable ? 'nullable' : 'not null'}, got ${schemaColumn.nullable ? 'nullable' : 'not null'}`,
              expected: contractColumn.nullable,
              actual: schemaColumn.nullable,
              children: [],
            });
            columnStatus = 'fail';
          }

          // Compute column status from children (fail > warn > pass)
          const computedColumnStatus = columnChildren.some((c) => c.status === 'fail')
            ? 'fail'
            : columnChildren.some((c) => c.status === 'warn')
              ? 'warn'
              : 'pass';
          // Use computed status if we have children, otherwise use the manually set status
          const finalColumnStatus = columnChildren.length > 0 ? computedColumnStatus : columnStatus;

          // Build column node
          const nullableText = contractColumn.nullable ? 'nullable' : 'not nullable';
          // Format: columnName: nativeType (codecId) (nullability)
          // Reuse contractNativeType from above scope
          const columnTypeDisplay = contractColumn.codecId
            ? `${contractNativeType} (${contractColumn.codecId})`
            : contractNativeType;
          // Collect failure messages from children to create a summary message
          const failureMessages = columnChildren
            .filter((child) => child.status === 'fail' && child.message)
            .map((child) => child.message)
            .filter((msg): msg is string => typeof msg === 'string' && msg.length > 0);
          const columnMessage =
            finalColumnStatus === 'fail' && failureMessages.length > 0
              ? failureMessages.join('; ')
              : '';
          const columnCode =
            finalColumnStatus === 'fail' && columnChildren.length > 0 && columnChildren[0]
              ? columnChildren[0].code
              : finalColumnStatus === 'warn' && columnChildren.length > 0 && columnChildren[0]
                ? columnChildren[0].code
                : '';
          columnNodes.push({
            status: finalColumnStatus,
            kind: 'column',
            name: `${columnName}: ${columnTypeDisplay} (${nullableText})`,
            contractPath: columnPath,
            code: columnCode,
            message: columnMessage,
            expected: undefined,
            actual: undefined,
            children: columnChildren,
          });
        }

        // Group columns under a "columns" header if we have any columns
        if (columnNodes.length > 0) {
          const columnsStatus = columnNodes.some((c) => c.status === 'fail')
            ? 'fail'
            : columnNodes.some((c) => c.status === 'warn')
              ? 'warn'
              : 'pass';
          tableChildren.push({
            status: columnsStatus,
            kind: 'columns',
            name: 'columns',
            contractPath: `${tablePath}.columns`,
            code: '',
            message: '',
            expected: undefined,
            actual: undefined,
            children: columnNodes,
          });
        }

        // Check for extra columns in strict mode
        if (strict) {
          for (const [columnName, schemaColumn] of Object.entries(schemaTable.columns)) {
            if (!contractTable.columns[columnName]) {
              issues.push({
                kind: 'missing_column',
                table: tableName,
                column: columnName,
                message: `Extra column "${tableName}"."${columnName}" found in database (not in contract)`,
              });
              columnNodes.push({
                status: 'fail',
                kind: 'column',
                name: `${columnName}: extra`,
                contractPath: `${tablePath}.columns.${columnName}`,
                code: 'extra_column',
                message: `Extra column "${columnName}" found`,
                expected: undefined,
                actual: schemaColumn.nativeType,
                children: [],
              });
            }
          }
        }

        // Compare primary key
        if (contractTable.primaryKey) {
          const pkStatus = comparePrimaryKey(
            contractTable.primaryKey,
            schemaTable.primaryKey,
            tableName,
            issues,
          );
          if (pkStatus === 'fail') {
            tableChildren.push({
              status: 'fail',
              kind: 'primaryKey',
              name: `primary key: ${contractTable.primaryKey.columns.join(', ')}`,
              contractPath: `${tablePath}.primaryKey`,
              code: 'primary_key_mismatch',
              message: 'Primary key mismatch',
              expected: contractTable.primaryKey,
              actual: schemaTable.primaryKey,
              children: [],
            });
          } else {
            tableChildren.push({
              status: 'pass',
              kind: 'primaryKey',
              name: `primary key: ${contractTable.primaryKey.columns.join(', ')}`,
              contractPath: `${tablePath}.primaryKey`,
              code: '',
              message: '',
              expected: undefined,
              actual: undefined,
              children: [],
            });
          }
        } else if (schemaTable.primaryKey && strict) {
          // Extra primary key in strict mode
          issues.push({
            kind: 'primary_key_mismatch',
            table: tableName,
            message: 'Extra primary key found in database (not in contract)',
          });
          tableChildren.push({
            status: 'fail',
            kind: 'primaryKey',
            name: `primary key: ${schemaTable.primaryKey.columns.join(', ')}`,
            contractPath: `${tablePath}.primaryKey`,
            code: 'extra_primary_key',
            message: 'Extra primary key found',
            expected: undefined,
            actual: schemaTable.primaryKey,
            children: [],
          });
        }

        // Compare foreign keys
        const fkStatuses = compareForeignKeys(
          contractTable.foreignKeys,
          schemaTable.foreignKeys,
          tableName,
          tablePath,
          issues,
          strict,
        );
        tableChildren.push(...fkStatuses);

        // Compare unique constraints
        const uniqueStatuses = compareUniqueConstraints(
          contractTable.uniques,
          schemaTable.uniques,
          tableName,
          tablePath,
          issues,
          strict,
        );
        tableChildren.push(...uniqueStatuses);

        // Compare indexes
        const indexStatuses = compareIndexes(
          contractTable.indexes,
          schemaTable.indexes,
          tableName,
          tablePath,
          issues,
          strict,
        );
        tableChildren.push(...indexStatuses);

        // Build table node
        const tableStatus = tableChildren.some((c) => c.status === 'fail')
          ? 'fail'
          : tableChildren.some((c) => c.status === 'warn')
            ? 'warn'
            : 'pass';
        // Collect failure messages from children to create a summary message
        const tableFailureMessages = tableChildren
          .filter((child) => child.status === 'fail' && child.message)
          .map((child) => child.message)
          .filter((msg): msg is string => typeof msg === 'string' && msg.length > 0);
        const tableMessage =
          tableStatus === 'fail' && tableFailureMessages.length > 0
            ? `${tableFailureMessages.length} issue${tableFailureMessages.length === 1 ? '' : 's'}`
            : '';
        const tableCode =
          tableStatus === 'fail' && tableChildren.length > 0 && tableChildren[0]
            ? tableChildren[0].code
            : '';
        rootChildren.push({
          status: tableStatus,
          kind: 'table',
          name: `table ${tableName}`,
          contractPath: tablePath,
          code: tableCode,
          message: tableMessage,
          expected: undefined,
          actual: undefined,
          children: tableChildren,
        });
      }

      // Check for extra tables in strict mode
      if (strict) {
        for (const tableName of Object.keys(schemaTables)) {
          if (!contractTables[tableName]) {
            issues.push({
              kind: 'missing_table',
              table: tableName,
              message: `Extra table "${tableName}" found in database (not in contract)`,
            });
            rootChildren.push({
              status: 'fail',
              kind: 'table',
              name: `table ${tableName}`,
              contractPath: `storage.tables.${tableName}`,
              code: 'extra_table',
              message: `Extra table "${tableName}" found`,
              expected: undefined,
              actual: undefined,
              children: [],
            });
          }
        }
      }

      // Compare extensions
      const extensionStatuses = compareExtensions(
        contract.extensions,
        schemaIR.extensions,
        contractTarget,
        issues,
        strict,
      );
      rootChildren.push(...extensionStatuses);

      // Build root node
      const rootStatus = rootChildren.some((c) => c.status === 'fail')
        ? 'fail'
        : rootChildren.some((c) => c.status === 'warn')
          ? 'warn'
          : 'pass';
      const root: SchemaVerificationNode = {
        status: rootStatus,
        kind: 'contract',
        name: 'contract',
        contractPath: '',
        code: '',
        message: '',
        expected: undefined,
        actual: undefined,
        children: rootChildren,
      };

      // Compute counts
      const counts = computeCounts(root);

      // Set ok flag
      const ok = counts.fail === 0;

      // Set code
      const code = ok ? undefined : 'PN-SCHEMA-0001';

      // Set summary
      const summary = ok
        ? 'Database schema satisfies contract'
        : `Database schema does not satisfy contract (${counts.fail} failure${counts.fail === 1 ? '' : 's'})`;

      const totalTime = Date.now() - startTime;

      return {
        ok,
        ...(code ? { code } : {}),
        summary,
        contract: {
          coreHash: contractCoreHash,
          ...(contractProfileHash ? { profileHash: contractProfileHash } : {}),
        },
        target: {
          expected: contractTarget,
          actual: contractTarget,
        },
        schema: {
          issues,
          root,
          counts,
        },
        meta: {
          contractPath,
          strict,
          ...(configPath ? { configPath } : {}),
        },
        timings: {
          total: totalTime,
        },
      };
    },
    async sign(options: {
      readonly driver: ControlDriverInstance;
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
      readonly driver: ControlDriverInstance;
      readonly contractIR?: unknown;
    }): Promise<SqlSchemaIR> {
      const { driver, contractIR } = options;

      // ControlAdapterDescriptor has create() method that returns SqlControlAdapter
      const controlAdapter = adapter.create() as SqlControlAdapter;
      return controlAdapter.introspect(driver as ControlDriverInstance<string>, contractIR);
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
