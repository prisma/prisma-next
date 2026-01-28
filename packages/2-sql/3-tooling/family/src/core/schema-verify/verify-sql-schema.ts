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
  const { contract, schema, strict, context, typeMetadataRegistry } = options;
  const startTime = Date.now();

  // Extract contract hashes and target
  const contractCoreHash = contract.coreHash;
  const contractProfileHash =
    'profileHash' in contract && typeof contract.profileHash === 'string'
      ? contract.profileHash
      : undefined;
  const contractTarget = contract.target;

  // Compare contract vs schema IR
  const issues: SchemaIssue[] = [];
  const rootChildren: SchemaVerificationNode[] = [];

  // Compare tables
  const contractTables = contract.storage.tables;
  const schemaTables = schema.tables;

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
      // Both contractColumn.nativeType and schemaColumn.nativeType are required by their types
      const contractNativeType = contractColumn.nativeType;
      const schemaNativeType = schemaColumn.nativeType;

      if (contractNativeType !== schemaNativeType) {
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

      // Compare column defaults semantically
      // Both contract and schema now use the same ColumnDefault type for proper comparison
      if (contractColumn.default) {
        if (!schemaColumn.default) {
          // Contract expects a default but database doesn't have one
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
        } else if (!columnDefaultsEqual(contractColumn.default, schemaColumn.default)) {
          // Both have defaults but they differ
          const expectedDescription = describeColumnDefault(contractColumn.default);
          const actualDescription = describeColumnDefault(schemaColumn.default);
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
      // Extract code from first child if status indicates an issue
      const columnCode =
        (finalColumnStatus === 'fail' || finalColumnStatus === 'warn') && columnChildren[0]
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

    // Compare primary key
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
      // Extra primary key in strict mode
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

    // Compare foreign keys
    const fkStatuses = verifyForeignKeys(
      contractTable.foreignKeys,
      schemaTable.foreignKeys,
      tableName,
      tablePath,
      issues,
      strict,
    );
    tableChildren.push(...fkStatuses);

    // Compare unique constraints
    // Pass schemaIndexes so unique indexes can satisfy unique constraint requirements
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

    // Compare indexes
    // Pass schemaUniques so unique constraints can satisfy index requirements
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

  // Validate that all extension packs declared in the contract are present in frameworkComponents
  // This is a configuration integrity check - if the contract was emitted with an extension,
  // that extension must be provided in the current configuration.
  // Note: contract.extensionPacks includes adapter.id and target.id (from extractExtensionIds),
  // so we check for matches as extension, adapter, or target components.
  const contractExtensionPacks = contract.extensionPacks ?? {};
  for (const extensionNamespace of Object.keys(contractExtensionPacks)) {
    const hasComponent = options.frameworkComponents.some(
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

  // Compare component-owned database dependencies (pure, deterministic)
  // Per ADR 154: We do NOT infer dependencies from contract extension packs.
  // Dependencies are only collected from frameworkComponents provided by the CLI.
  const databaseDependencies = collectDependenciesFromFrameworkComponents(
    options.frameworkComponents,
  );
  const dependencyStatuses = verifyDatabaseDependencies(databaseDependencies, schema, issues);
  rootChildren.push(...dependencyStatuses);

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
 * Compares two ColumnDefault values for semantic equality.
 * Both must have the same kind and matching value/expression.
 */
function columnDefaultsEqual(a: ColumnDefault, b: ColumnDefault): boolean {
  if (a.kind !== b.kind) {
    return false;
  }
  if (a.kind === 'literal' && b.kind === 'literal') {
    const normalizeLiteral = (expr: string) => expr.trim();
    return normalizeLiteral(a.expression) === normalizeLiteral(b.expression);
  }
  if (a.kind === 'function' && b.kind === 'function') {
    // Normalize function expressions for comparison (case-insensitive, whitespace-tolerant)
    const normalizeExpr = (expr: string) => expr.toLowerCase().replace(/\s+/g, '');
    return normalizeExpr(a.expression) === normalizeExpr(b.expression);
  }
  return false;
}
