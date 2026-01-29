/**
 * Pure SQL schema verification function.
 *
 * This module provides a pure function that verifies a SqlSchemaIR against
 * a SqlContract without requiring a database connection. It can be reused
 * by migration planners and other tools that need to compare schema states.
 */

import type { TargetBoundComponentDescriptor } from '@prisma-next/contract/framework-components';
import type { ColumnDefault } from '@prisma-next/contract/types';
import type {
  OperationContext,
  SchemaIssue,
  SchemaVerificationNode,
  VerifyDatabaseSchemaResult,
} from '@prisma-next/core-control-plane/types';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import { ifDefined } from '@prisma-next/utils/defined';
import type { ComponentDatabaseDependency } from '../migrations/types';
import {
  computeCounts,
  verifyDatabaseDependencies,
  verifyForeignKeys,
  verifyIndexes,
  verifyPrimaryKey,
  verifyUniqueConstraints,
} from './verify-helpers';

/**
 * Function type for normalizing raw database default expressions into ColumnDefault.
 * Target-specific implementations handle database dialect differences.
 */
export type DefaultNormalizer = (
  rawDefault: string,
  nativeType: string,
) => ColumnDefault | undefined;

/**
 * Options for the pure schema verification function.
 */
export interface VerifySqlSchemaOptions {
  /** The validated SQL contract to verify against */
  readonly contract: SqlContract<SqlStorage>;
  /** The schema IR from introspection (or another source) */
  readonly schema: SqlSchemaIR;
  /** Whether to run in strict mode (detects extra tables/columns) */
  readonly strict: boolean;
  /** Optional operation context for metadata */
  readonly context?: OperationContext;
  /** Type metadata registry for codec consistency warnings */
  readonly typeMetadataRegistry: ReadonlyMap<string, { nativeType?: string }>;
  /**
   * Active framework components participating in this composition.
   * All components must have matching familyId ('sql') and targetId.
   */
  readonly frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<'sql', string>>;
  /**
   * Optional target-specific normalizer for raw database default expressions.
   * When provided, schema defaults (raw strings) are normalized before comparison
   * with contract defaults (ColumnDefault objects).
   */
  readonly normalizeDefault?: DefaultNormalizer;
}

/**
 * Verifies that a SqlSchemaIR matches a SqlContract.
 *
 * This is a pure function that does NOT perform any database I/O.
 * It takes an already-introspected schema IR and compares it against
 * the contract requirements.
 *
 * @param options - Verification options
 * @returns VerifyDatabaseSchemaResult with verification tree and issues
 */
export function verifySqlSchema(options: VerifySqlSchemaOptions): VerifyDatabaseSchemaResult {
  const { contract, schema, strict, context, typeMetadataRegistry, normalizeDefault } = options;
  const startTime = Date.now();

  const { contractCoreHash, contractProfileHash, contractTarget } =
    extractContractMetadata(contract);
  const { issues, rootChildren } = verifySchemaTables({
    contract,
    schema,
    strict,
    typeMetadataRegistry,
    ...(normalizeDefault ? { normalizeDefault } : {}),
  });

  validateFrameworkComponentsForExtensions(contract, options.frameworkComponents);

  const databaseDependencies = collectDependenciesFromFrameworkComponents(
    options.frameworkComponents,
  );
  const dependencyStatuses = verifyDatabaseDependencies(databaseDependencies, schema, issues);
  rootChildren.push(...dependencyStatuses);

  const root = buildRootNode(rootChildren);

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
    ...ifDefined('code', code),
    summary,
    contract: {
      coreHash: contractCoreHash,
      ...ifDefined('profileHash', contractProfileHash),
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
      strict,
      ...ifDefined('contractPath', context?.contractPath),
      ...ifDefined('configPath', context?.configPath),
    },
    timings: {
      total: totalTime,
    },
  };
}

type VerificationStatus = 'pass' | 'warn' | 'fail';

function extractContractMetadata(contract: SqlContract<SqlStorage>): {
  contractCoreHash: SqlContract<SqlStorage>['coreHash'];
  contractProfileHash?: SqlContract<SqlStorage>['profileHash'];
  contractTarget: SqlContract<SqlStorage>['target'];
} {
  return {
    contractCoreHash: contract.coreHash,
    contractProfileHash:
      'profileHash' in contract && typeof contract.profileHash === 'string'
        ? contract.profileHash
        : undefined,
    contractTarget: contract.target,
  };
}

function verifySchemaTables(options: {
  contract: SqlContract<SqlStorage>;
  schema: SqlSchemaIR;
  strict: boolean;
  typeMetadataRegistry: ReadonlyMap<string, { nativeType?: string }>;
  normalizeDefault?: DefaultNormalizer;
}): { issues: SchemaIssue[]; rootChildren: SchemaVerificationNode[] } {
  const { contract, schema, strict, typeMetadataRegistry, normalizeDefault } = options;
  const issues: SchemaIssue[] = [];
  const rootChildren: SchemaVerificationNode[] = [];
  const contractTables = contract.storage.tables;
  const schemaTables = schema.tables;

  for (const [tableName, contractTable] of Object.entries(contractTables)) {
    const schemaTable = schemaTables[tableName];
    const tablePath = `storage.tables.${tableName}`;

    if (!schemaTable) {
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

    const tableChildren = verifyTableChildren({
      contractTable,
      schemaTable,
      tableName,
      tablePath,
      issues,
      strict,
      typeMetadataRegistry,
      ...(normalizeDefault ? { normalizeDefault } : {}),
    });
    rootChildren.push(buildTableNode(tableName, tablePath, tableChildren));
  }

  if (strict) {
    for (const tableName of Object.keys(schemaTables)) {
      if (!contractTables[tableName]) {
        issues.push({
          kind: 'extra_table',
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

  return { issues, rootChildren };
}

function verifyTableChildren(options: {
  contractTable: SqlContract<SqlStorage>['storage']['tables'][string];
  schemaTable: SqlSchemaIR['tables'][string];
  tableName: string;
  tablePath: string;
  issues: SchemaIssue[];
  strict: boolean;
  typeMetadataRegistry: ReadonlyMap<string, { nativeType?: string }>;
  normalizeDefault?: DefaultNormalizer;
}): SchemaVerificationNode[] {
  const {
    contractTable,
    schemaTable,
    tableName,
    tablePath,
    issues,
    strict,
    typeMetadataRegistry,
    normalizeDefault,
  } = options;
  const tableChildren: SchemaVerificationNode[] = [];
  const columnNodes = collectContractColumnNodes({
    contractTable,
    schemaTable,
    tableName,
    tablePath,
    issues,
    typeMetadataRegistry,
    ...(normalizeDefault ? { normalizeDefault } : {}),
  });
  if (columnNodes.length > 0) {
    tableChildren.push(buildColumnsNode(tablePath, columnNodes));
  }
  if (strict) {
    appendExtraColumnNodes({
      contractTable,
      schemaTable,
      tableName,
      tablePath,
      issues,
      columnNodes,
    });
  }

  if (contractTable.primaryKey) {
    const pkStatus = verifyPrimaryKey(
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
    issues.push({
      kind: 'extra_primary_key',
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

  const fkStatuses = verifyForeignKeys(
    contractTable.foreignKeys,
    schemaTable.foreignKeys,
    tableName,
    tablePath,
    issues,
    strict,
  );
  tableChildren.push(...fkStatuses);

  const uniqueStatuses = verifyUniqueConstraints(
    contractTable.uniques,
    schemaTable.uniques,
    schemaTable.indexes,
    tableName,
    tablePath,
    issues,
    strict,
  );
  tableChildren.push(...uniqueStatuses);

  const indexStatuses = verifyIndexes(
    contractTable.indexes,
    schemaTable.indexes,
    schemaTable.uniques,
    tableName,
    tablePath,
    issues,
    strict,
  );
  tableChildren.push(...indexStatuses);

  return tableChildren;
}

function collectContractColumnNodes(options: {
  contractTable: SqlContract<SqlStorage>['storage']['tables'][string];
  schemaTable: SqlSchemaIR['tables'][string];
  tableName: string;
  tablePath: string;
  issues: SchemaIssue[];
  typeMetadataRegistry: ReadonlyMap<string, { nativeType?: string }>;
  normalizeDefault?: DefaultNormalizer;
}): SchemaVerificationNode[] {
  const {
    contractTable,
    schemaTable,
    tableName,
    tablePath,
    issues,
    typeMetadataRegistry,
    normalizeDefault,
  } = options;
  const columnNodes: SchemaVerificationNode[] = [];

  for (const [columnName, contractColumn] of Object.entries(contractTable.columns)) {
    const schemaColumn = schemaTable.columns[columnName];
    const columnPath = `${tablePath}.columns.${columnName}`;

    if (!schemaColumn) {
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

    columnNodes.push(
      verifyColumn({
        tableName,
        columnName,
        contractColumn,
        schemaColumn,
        columnPath,
        issues,
        typeMetadataRegistry,
        ...(normalizeDefault ? { normalizeDefault } : {}),
      }),
    );
  }

  return columnNodes;
}

function appendExtraColumnNodes(options: {
  contractTable: SqlContract<SqlStorage>['storage']['tables'][string];
  schemaTable: SqlSchemaIR['tables'][string];
  tableName: string;
  tablePath: string;
  issues: SchemaIssue[];
  columnNodes: SchemaVerificationNode[];
}): void {
  const { contractTable, schemaTable, tableName, tablePath, issues, columnNodes } = options;
  for (const [columnName, { nativeType }] of Object.entries(schemaTable.columns)) {
    if (!contractTable.columns[columnName]) {
      issues.push({
        kind: 'extra_column',
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
        actual: nativeType,
        children: [],
      });
    }
  }
}

function verifyColumn(options: {
  tableName: string;
  columnName: string;
  contractColumn: SqlContract<SqlStorage>['storage']['tables'][string]['columns'][string];
  schemaColumn: SqlSchemaIR['tables'][string]['columns'][string];
  columnPath: string;
  issues: SchemaIssue[];
  typeMetadataRegistry: ReadonlyMap<string, { nativeType?: string }>;
  normalizeDefault?: DefaultNormalizer;
}): SchemaVerificationNode {
  const {
    tableName,
    columnName,
    contractColumn,
    schemaColumn,
    columnPath,
    issues,
    normalizeDefault,
  } = options;
  const columnChildren: SchemaVerificationNode[] = [];
  let columnStatus: VerificationStatus = 'pass';

  const contractNativeType = contractColumn.nativeType;
  const schemaNativeType = schemaColumn.nativeType;

  if (contractNativeType !== schemaNativeType) {
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

  if (contractColumn.codecId) {
    const typeMetadata = options.typeMetadataRegistry.get(contractColumn.codecId);
    if (!typeMetadata) {
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

  if (contractColumn.default) {
    if (!schemaColumn.default) {
      const defaultDescription = describeColumnDefault(contractColumn.default);
      issues.push({
        kind: 'default_missing',
        table: tableName,
        column: columnName,
        expected: defaultDescription,
        message: `Column "${tableName}"."${columnName}" should have default ${defaultDescription} but database has no default`,
      });
      columnChildren.push({
        status: 'fail',
        kind: 'default',
        name: 'default',
        contractPath: `${columnPath}.default`,
        code: 'default_missing',
        message: `Default missing: expected ${defaultDescription}`,
        expected: defaultDescription,
        actual: undefined,
        children: [],
      });
      columnStatus = 'fail';
    } else if (
      !columnDefaultsEqual(
        contractColumn.default,
        schemaColumn.default,
        normalizeDefault,
        schemaNativeType,
      )
    ) {
      const expectedDescription = describeColumnDefault(contractColumn.default);
      // schemaColumn.default is now a raw string, describe it as-is
      const actualDescription = schemaColumn.default;
      issues.push({
        kind: 'default_mismatch',
        table: tableName,
        column: columnName,
        expected: expectedDescription,
        actual: actualDescription,
        message: `Column "${tableName}"."${columnName}" has default mismatch: expected ${expectedDescription}, got ${actualDescription}`,
      });
      columnChildren.push({
        status: 'fail',
        kind: 'default',
        name: 'default',
        contractPath: `${columnPath}.default`,
        code: 'default_mismatch',
        message: `Default mismatch: expected ${expectedDescription}, got ${actualDescription}`,
        expected: expectedDescription,
        actual: actualDescription,
        children: [],
      });
      columnStatus = 'fail';
    }
  }

  const finalColumnStatus = mergeStatusFromChildren(columnChildren, columnStatus);
  const nullableText = contractColumn.nullable ? 'nullable' : 'not nullable';
  const columnTypeDisplay = contractColumn.codecId
    ? `${contractNativeType} (${contractColumn.codecId})`
    : contractNativeType;
  const columnMessage = summarizeFailureMessages(columnChildren, finalColumnStatus);
  const columnCode = selectNodeCode(columnChildren, finalColumnStatus);

  return {
    status: finalColumnStatus,
    kind: 'column',
    name: `${columnName}: ${columnTypeDisplay} (${nullableText})`,
    contractPath: columnPath,
    code: columnCode,
    message: columnMessage,
    expected: undefined,
    actual: undefined,
    children: columnChildren,
  };
}

function buildColumnsNode(
  tablePath: string,
  columnNodes: SchemaVerificationNode[],
): SchemaVerificationNode {
  return {
    status: mergeStatusFromChildren(columnNodes, 'pass'),
    kind: 'columns',
    name: 'columns',
    contractPath: `${tablePath}.columns`,
    code: '',
    message: '',
    expected: undefined,
    actual: undefined,
    children: columnNodes,
  };
}

function buildTableNode(
  tableName: string,
  tablePath: string,
  tableChildren: SchemaVerificationNode[],
): SchemaVerificationNode {
  const tableStatus = mergeStatusFromChildren(tableChildren, 'pass');
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

  return {
    status: tableStatus,
    kind: 'table',
    name: `table ${tableName}`,
    contractPath: tablePath,
    code: tableCode,
    message: tableMessage,
    expected: undefined,
    actual: undefined,
    children: tableChildren,
  };
}

function buildRootNode(rootChildren: SchemaVerificationNode[]): SchemaVerificationNode {
  return {
    status: mergeStatusFromChildren(rootChildren, 'pass'),
    kind: 'contract',
    name: 'contract',
    contractPath: '',
    code: '',
    message: '',
    expected: undefined,
    actual: undefined,
    children: rootChildren,
  };
}

function mergeStatusFromChildren(
  children: SchemaVerificationNode[],
  fallback: VerificationStatus,
): VerificationStatus {
  if (children.some((child) => child.status === 'fail')) {
    return 'fail';
  }
  if (children.some((child) => child.status === 'warn')) {
    return 'warn';
  }
  return fallback;
}

function summarizeFailureMessages(
  children: SchemaVerificationNode[],
  status: VerificationStatus,
): string {
  if (status !== 'fail') {
    return '';
  }
  const failureMessages = children
    .filter((child) => child.status === 'fail' && child.message)
    .map((child) => child.message)
    .filter((msg): msg is string => typeof msg === 'string' && msg.length > 0);
  return failureMessages.length > 0 ? failureMessages.join('; ') : '';
}

function selectNodeCode(children: SchemaVerificationNode[], status: VerificationStatus): string {
  if ((status === 'fail' || status === 'warn') && children[0]) {
    return children[0].code;
  }
  return '';
}

function validateFrameworkComponentsForExtensions(
  contract: SqlContract<SqlStorage>,
  frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<'sql', string>>,
): void {
  const contractExtensionPacks = contract.extensionPacks ?? {};
  for (const extensionNamespace of Object.keys(contractExtensionPacks)) {
    const hasComponent = frameworkComponents.some(
      (component) =>
        component.id === extensionNamespace &&
        (component.kind === 'extension' ||
          component.kind === 'adapter' ||
          component.kind === 'target'),
    );
    if (!hasComponent) {
      throw new Error(
        `Extension pack '${extensionNamespace}' is declared in the contract but not found in framework components. ` +
          'This indicates a configuration mismatch - the contract was emitted with this extension pack, ' +
          'but it is not provided in the current configuration.',
      );
    }
  }
}

/**
 * Type predicate to check if a component has database dependencies with an init array.
 * The familyId check is redundant since TargetBoundComponentDescriptor<'sql', T> already
 * guarantees familyId is 'sql' at the type level, so we don't need runtime checks for it.
 */
function hasDatabaseDependenciesInit<T extends string>(
  component: TargetBoundComponentDescriptor<'sql', T>,
): component is TargetBoundComponentDescriptor<'sql', T> & {
  readonly databaseDependencies: {
    readonly init: readonly ComponentDatabaseDependency<T>[];
  };
} {
  if (!('databaseDependencies' in component)) {
    return false;
  }
  const dbDeps = (component as Record<string, unknown>)['databaseDependencies'];
  if (dbDeps === undefined || dbDeps === null || typeof dbDeps !== 'object') {
    return false;
  }
  const depsRecord = dbDeps as Record<string, unknown>;
  const init = depsRecord['init'];
  if (init === undefined || !Array.isArray(init)) {
    return false;
  }
  return true;
}

function collectDependenciesFromFrameworkComponents<T extends string>(
  components: ReadonlyArray<TargetBoundComponentDescriptor<'sql', T>>,
): ReadonlyArray<ComponentDatabaseDependency<T>> {
  const dependencies: ComponentDatabaseDependency<T>[] = [];
  for (const component of components) {
    if (hasDatabaseDependenciesInit(component)) {
      dependencies.push(...component.databaseDependencies.init);
    }
  }
  return dependencies;
}

/**
 * Describes a column default for display purposes.
 */
function describeColumnDefault(columnDefault: ColumnDefault): string {
  switch (columnDefault.kind) {
    case 'literal':
      return `literal(${columnDefault.expression})`;
    case 'function':
      return columnDefault.expression;
  }
}

/**
 * Compares a contract ColumnDefault against a schema raw default string for semantic equality.
 *
 * When a normalizer is provided, the raw schema default is first normalized to a ColumnDefault
 * before comparison. Without a normalizer, falls back to direct string comparison against
 * the contract expression.
 *
 * @param contractDefault - The expected default from the contract (normalized ColumnDefault)
 * @param schemaDefault - The raw default expression from the database (string)
 * @param normalizer - Optional target-specific normalizer to convert raw defaults
 * @param nativeType - The column's native type, passed to normalizer for context
 */
function columnDefaultsEqual(
  contractDefault: ColumnDefault,
  schemaDefault: string,
  normalizer?: DefaultNormalizer,
  nativeType?: string,
): boolean {
  // If no normalizer provided, fall back to direct string comparison
  if (!normalizer) {
    return contractDefault.expression === schemaDefault;
  }

  // Normalize the raw schema default using target-specific logic
  const normalizedSchema = normalizer(schemaDefault, nativeType ?? '');
  if (!normalizedSchema) {
    // Normalizer couldn't parse the expression - treat as mismatch
    return false;
  }

  // Compare normalized defaults
  if (contractDefault.kind !== normalizedSchema.kind) {
    return false;
  }
  if (contractDefault.kind === 'literal' && normalizedSchema.kind === 'literal') {
    const normalizeLiteral = (expr: string) => expr.trim();
    return (
      normalizeLiteral(contractDefault.expression) === normalizeLiteral(normalizedSchema.expression)
    );
  }
  if (contractDefault.kind === 'function' && normalizedSchema.kind === 'function') {
    // Normalize function expressions for comparison (case-insensitive, whitespace-tolerant)
    const normalizeExpr = (expr: string) => expr.toLowerCase().replace(/\s+/g, '');
    return normalizeExpr(contractDefault.expression) === normalizeExpr(normalizedSchema.expression);
  }
  return false;
}
