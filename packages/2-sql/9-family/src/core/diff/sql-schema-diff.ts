/**
 * Pure SQL schema verification function.
 *
 * This module provides a pure function that verifies a SqlSchemaIR against
 * a Contract without requiring a database connection. It can be reused
 * by migration planners and other tools that need to compare schema states.
 */

import type { ColumnDefault, Contract, ControlPolicy } from '@prisma-next/contract/types';
import { effectiveControlPolicy } from '@prisma-next/contract/types';
import type { TargetBoundComponentDescriptor } from '@prisma-next/framework-components/components';
import type {
  OperationContext,
  SchemaIssue,
  SchemaVerificationNode,
  VerificationStatus,
  VerifyDatabaseSchemaResult,
} from '@prisma-next/framework-components/control';

import {
  isStorageTypeInstance,
  type SqlStorage,
  type StorageColumn,
  StorageTable,
  type StorageTypeInstance,
} from '@prisma-next/sql-contract/types';
import type { SqlSchemaIR, SqlSchemaIRNode } from '@prisma-next/sql-schema-ir/types';
import { canonicalStringify } from '@prisma-next/utils/canonical-stringify';
import { blindCast } from '@prisma-next/utils/casts';
import { ifDefined } from '@prisma-next/utils/defined';
import { extractCodecControlHooks } from '../assembly';
import { resolveValueSetValues } from '../migrations/contract-to-schema-ir';
import type { CodecControlHooks } from '../migrations/types';
import { emitIssueAndNodeUnderControlPolicy } from './control-verify-emit';
import { verifierDisposition } from './verifier-disposition';
import {
  arraysEqual,
  computeCounts,
  verifyCheckConstraints,
  verifyForeignKeys,
  verifyIndexes,
  verifyPrimaryKey,
  verifyUniqueConstraints,
} from './verify-helpers';

/**
 * Returns the per-schema namespace nodes of an introspected schema node, for
 * the relational verify to consume one at a time. Structure-agnostic — imports
 * no target node class. A root exposing a `namespaces` record (Postgres) yields
 * its namespace nodes (never merged, so same-named tables in different schemas
 * cannot collide); a flat schema (SQLite) is its own single namespace and
 * yields itself. Handles spread-flattened input (own-enumerable fields survive).
 */
function namespaceSchemaNodes(schema: SqlSchemaIRNode): readonly SqlSchemaIR[] {
  const obj = blindCast<
    { readonly namespaces?: Readonly<Record<string, SqlSchemaIR>> },
    'structural read of an own-enumerable namespaces record; survives the projectSchemaToSpace spread'
  >(schema);
  if (obj.namespaces !== undefined) {
    return Object.values(obj.namespaces);
  }
  return [
    blindCast<
      SqlSchemaIR,
      'a flat schema node (no namespaces) is its own single namespace, exposing the per-schema { tables } shape'
    >(schema),
  ];
}

/**
 * Function type for normalizing raw database default expressions into ColumnDefault.
 * Target-specific implementations handle database dialect differences.
 */
export type DefaultNormalizer = (
  rawDefault: string,
  nativeType: string,
) => ColumnDefault | undefined;

/**
 * Function type for normalizing schema native types to canonical form for comparison.
 * Target-specific implementations handle dialect-specific type name variations
 * (e.g., Postgres 'varchar' → 'character varying', 'timestamptz' normalization).
 */
export type NativeTypeNormalizer = (nativeType: string) => string;

/**
 * Options for the pure schema verification function.
 */
export interface VerifySqlSchemaOptions {
  /** The validated SQL contract to verify against */
  readonly contract: Contract<SqlStorage>;
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
  /**
   * Optional target-specific normalizer for schema native type names.
   * When provided, schema native types are normalized before comparison
   * with contract native types (e.g., Postgres 'varchar' → 'character varying').
   */
  readonly normalizeNativeType?: NativeTypeNormalizer;
  /**
   * When set, only the contract tables in these namespace ids are checked
   * against `schema` (the matching actual namespace node). The full contract is
   * still consulted for cross-namespace value-set / control-policy resolution.
   * Used by the multi-schema verify, which pairs each contract namespace to its
   * own actual node. Absent ⇒ all contract namespaces are checked against the
   * single (flat) `schema` — the single-schema / SQLite path.
   */
  readonly restrictToNamespaceIds?: ReadonlySet<string>;
}

/**
 * Verifies that a SqlSchemaIR matches a Contract.
 *
 * This is a pure function that does NOT perform any database I/O.
 * It takes an already-introspected schema IR and compares it against
 * the contract requirements.
 *
 * @param options - Verification options
 * @returns VerifyDatabaseSchemaResult with verification tree and issues
 */
export function verifySqlSchema(options: VerifySqlSchemaOptions): VerifyDatabaseSchemaResult {
  const {
    contract,
    schema,
    strict,
    context,
    typeMetadataRegistry,
    normalizeDefault,
    normalizeNativeType,
  } = options;
  const startTime = Date.now();

  // Extract codec control hooks once at entry point for reuse
  const codecHooks = extractCodecControlHooks(options.frameworkComponents);

  const { contractStorageHash, contractProfileHash, contractTarget } =
    extractContractMetadata(contract);
  const storageTypes: Readonly<Record<string, StorageTypeInstance>> = contract.storage.types ?? {};
  const { issues, rootChildren } = verifySchemaTables({
    contract,
    schema,
    strict,
    typeMetadataRegistry,
    codecHooks,
    storageTypes,
    ...ifDefined('normalizeDefault', normalizeDefault),
    ...ifDefined('normalizeNativeType', normalizeNativeType),
    ...ifDefined('restrictToNamespaceIds', options.restrictToNamespaceIds),
  });

  validateFrameworkComponentsForExtensions(contract, options.frameworkComponents);

  const typeNodes: SchemaVerificationNode[] = [];
  // Storage-type findings dispatch through the same control policy as tables
  // and columns: each issue's disposition (fail / warn / suppress) is resolved
  // from the type's effective control so an `external`/`observed` enum no longer
  // hard-fails on value drift. `suppress` drops the issue entirely; the node
  // status is the worst surviving disposition.
  const pushTypeNode = (
    typeName: string,
    contractPath: string,
    typeIssues: readonly SchemaIssue[],
    controlPolicy: ControlPolicy,
  ): void => {
    let status: VerificationStatus = 'pass';
    let code = '';
    let emitted = 0;
    for (const issue of typeIssues) {
      const disposition = verifierDisposition(controlPolicy, issue.kind);
      if (disposition === 'suppress') continue;
      issues.push(issue);
      emitted += 1;
      if (code === '') code = issue.kind;
      if (disposition === 'fail') {
        status = 'fail';
      } else if (disposition === 'warn' && status !== 'fail') {
        status = 'warn';
      }
    }
    typeNodes.push({
      status,
      kind: 'storageType',
      name: `type ${typeName}`,
      contractPath,
      code: status === 'pass' ? '' : code,
      message: emitted > 0 ? `${emitted} issue${emitted === 1 ? '' : 's'}` : '',
      expected: undefined,
      actual: undefined,
      children: [],
    });
  };

  // Top-level `storage.types`: codec-typed entries via codec hooks.
  for (const [typeName, typeInstance] of Object.entries(contract.storage.types ?? {})) {
    if (isStorageTypeInstance(typeInstance)) {
      const hook = codecHooks.get(typeInstance.codecId);
      pushTypeNode(
        typeName,
        `storage.types.${typeName}`,
        hook?.verifyType ? hook.verifyType({ typeName, typeInstance, schema }) : [],
        effectiveControlPolicy(undefined, contract.defaultControlPolicy),
      );
    }
  }

  if (typeNodes.length > 0) {
    const typesStatus: VerificationStatus = typeNodes.some((n) => n.status === 'fail')
      ? 'fail'
      : typeNodes.some((n) => n.status === 'warn')
        ? 'warn'
        : 'pass';
    rootChildren.push({
      status: typesStatus,
      kind: 'storageTypes',
      name: 'types',
      contractPath: 'storage.types',
      code: typesStatus === 'fail' ? 'type_mismatch' : '',
      message: '',
      expected: undefined,
      actual: undefined,
      children: typeNodes,
    });
  }

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
      storageHash: contractStorageHash,
      ...ifDefined('profileHash', contractProfileHash),
    },
    target: {
      expected: contractTarget,
      actual: contractTarget,
    },
    schema: {
      issues,
      schemaDiffIssues: [],
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

function extractContractMetadata(contract: Contract<SqlStorage>): {
  contractStorageHash: SqlStorage['storageHash'];
  contractProfileHash?: Contract<SqlStorage>['profileHash'] | undefined;
  contractTarget: Contract<SqlStorage>['target'];
} {
  return {
    contractStorageHash: contract.storage.storageHash,
    contractProfileHash:
      'profileHash' in contract && typeof contract.profileHash === 'string'
        ? contract.profileHash
        : undefined,
    contractTarget: contract.target,
  };
}

function verifySchemaTables(options: {
  contract: Contract<SqlStorage>;
  schema: SqlSchemaIR;
  strict: boolean;
  typeMetadataRegistry: ReadonlyMap<string, { nativeType?: string }>;
  codecHooks: Map<string, CodecControlHooks>;
  storageTypes: Readonly<Record<string, StorageTypeInstance>>;
  normalizeDefault?: DefaultNormalizer;
  normalizeNativeType?: NativeTypeNormalizer;
  restrictToNamespaceIds?: ReadonlySet<string>;
}): { issues: SchemaIssue[]; rootChildren: SchemaVerificationNode[] } {
  const {
    contract,
    schema,
    strict,
    typeMetadataRegistry,
    codecHooks,
    storageTypes,
    normalizeDefault,
    normalizeNativeType,
    restrictToNamespaceIds,
  } = options;
  const contractDefaultControl = contract.defaultControlPolicy;
  const issues: SchemaIssue[] = [];
  const rootChildren: SchemaVerificationNode[] = [];
  const schemaTables = schema.tables;
  const namespaceIds = Object.keys(contract.storage.namespaces).sort((a, b) =>
    a < b ? -1 : a > b ? 1 : 0,
  );

  for (const namespaceId of namespaceIds) {
    // When the caller pairs each contract namespace to its own actual node, it
    // restricts the table check to that namespace; the full contract is still
    // consulted for value-set / control-policy resolution.
    if (restrictToNamespaceIds !== undefined && !restrictToNamespaceIds.has(namespaceId)) continue;
    const ns = contract.storage.namespaces[namespaceId];
    if (!ns) continue;
    for (const [tableName, contractTableRaw] of Object.entries(ns.entries.table ?? {})) {
      StorageTable.assert(
        contractTableRaw,
        `storage.namespaces.${namespaceId}.entries.table.${tableName}`,
      );
      const contractTable = contractTableRaw;
      const tableControlPolicy = effectiveControlPolicy(
        contractTable.control,
        contractDefaultControl,
      );
      const schemaTable = schemaTables[tableName];
      const tablePath = `storage.namespaces.${namespaceId}.entries.table.${tableName}`;

      if (!schemaTable) {
        const issue: SchemaIssue = {
          kind: 'missing_table',
          reason: 'not-found',
          table: tableName,
          namespaceId,
          message: `Table "${tableName}" is missing from database`,
        };
        emitIssueAndNodeUnderControlPolicy(
          tableControlPolicy,
          issue,
          {
            status: 'fail',
            kind: 'table',
            name: `table ${tableName}`,
            contractPath: tablePath,
            code: 'missing_table',
            message: `Table "${tableName}" is missing`,
            expected: undefined,
            actual: undefined,
            children: [],
          },
          issues,
          rootChildren,
        );
        continue;
      }

      const tableChildren = verifyTableChildren({
        contractTable,
        schemaTable,
        tableName,
        namespaceId,
        tablePath,
        tableControlPolicy,
        issues,
        strict,
        typeMetadataRegistry,
        codecHooks,
        storageTypes,
        contractStorage: contract.storage,
        ...ifDefined('normalizeDefault', normalizeDefault),
        ...ifDefined('normalizeNativeType', normalizeNativeType),
      });
      rootChildren.push(buildTableNode(tableName, tablePath, tableChildren));
    }
  }

  if (strict) {
    for (const tableName of Object.keys(schemaTables)) {
      const claimed = namespaceIds.some(
        (namespaceId) =>
          contract.storage.namespaces[namespaceId]?.entries.table?.[tableName] !== undefined,
      );
      if (!claimed) {
        const extraTableControlPolicy = effectiveControlPolicy(undefined, contractDefaultControl);
        const issue: SchemaIssue = {
          kind: 'extra_table',
          reason: 'not-expected',
          table: tableName,
          message: `Extra table "${tableName}" found in database (not in contract)`,
        };
        emitIssueAndNodeUnderControlPolicy(
          extraTableControlPolicy,
          issue,
          {
            status: 'fail',
            kind: 'table',
            name: `table ${tableName}`,
            contractPath: `storage.namespaces.*.entries.table.${tableName}`,
            code: 'extra_table',
            message: `Extra table "${tableName}" found`,
            expected: undefined,
            actual: undefined,
            children: [],
            reason: 'not-expected',
          },
          issues,
          rootChildren,
        );
      }
    }
  }

  return { issues, rootChildren };
}

function verifyTableChildren(options: {
  contractTable: StorageTable;
  schemaTable: SqlSchemaIR['tables'][string];
  tableName: string;
  namespaceId: string;
  tablePath: string;
  tableControlPolicy: ControlPolicy;
  issues: SchemaIssue[];
  strict: boolean;
  typeMetadataRegistry: ReadonlyMap<string, { nativeType?: string }>;
  codecHooks: Map<string, CodecControlHooks>;
  storageTypes: Readonly<Record<string, StorageTypeInstance>>;
  normalizeDefault?: DefaultNormalizer;
  normalizeNativeType?: NativeTypeNormalizer;
  contractStorage: SqlStorage;
}): SchemaVerificationNode[] {
  const {
    contractTable,
    schemaTable,
    tableName,
    namespaceId,
    tablePath,
    tableControlPolicy,
    issues,
    strict,
    typeMetadataRegistry,
    codecHooks,
    storageTypes,
    normalizeDefault,
    normalizeNativeType,
    contractStorage,
  } = options;
  const tableChildren: SchemaVerificationNode[] = [];
  const columnNodes = collectContractColumnNodes({
    contractTable,
    schemaTable,
    tableName,
    namespaceId,
    tablePath,
    tableControlPolicy,
    issues,
    strict,
    typeMetadataRegistry,
    codecHooks,
    storageTypes,
    ...ifDefined('normalizeDefault', normalizeDefault),
    ...ifDefined('normalizeNativeType', normalizeNativeType),
  });
  if (columnNodes.length > 0) {
    tableChildren.push(buildColumnsNode(tablePath, columnNodes));
  }
  if (strict) {
    appendExtraColumnNodes({
      contractTable,
      schemaTable,
      tableName,
      namespaceId,
      tablePath,
      tableControlPolicy,
      issues,
      columnNodes,
    });
  }

  if (contractTable.primaryKey) {
    const pkStatus = verifyPrimaryKey(
      contractTable.primaryKey,
      schemaTable.primaryKey,
      tableName,
      namespaceId,
      tableControlPolicy,
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
    } else if (pkStatus === 'warn') {
      tableChildren.push({
        status: 'warn',
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
    const issue: SchemaIssue = {
      kind: 'extra_primary_key',
      reason: 'not-expected',
      table: tableName,
      namespaceId,
      message: 'Extra primary key found in database (not in contract)',
    };
    emitIssueAndNodeUnderControlPolicy(
      tableControlPolicy,
      issue,
      {
        status: 'fail',
        kind: 'primaryKey',
        name: `primary key: ${schemaTable.primaryKey.columns.join(', ')}`,
        contractPath: `${tablePath}.primaryKey`,
        code: 'extra_primary_key',
        message: 'Extra primary key found',
        expected: undefined,
        actual: schemaTable.primaryKey,
        children: [],
      },
      issues,
      tableChildren,
    );
  }

  // Verify FK constraints only for FKs with constraint: true.
  // Always call when strict mode is on so extra-FK detection runs even if
  // the contract has no FKs for this table.
  const constraintFks = contractTable.foreignKeys.filter((fk) => fk.constraint === true);
  if (constraintFks.length > 0 || strict) {
    const fkStatuses = verifyForeignKeys(
      constraintFks,
      schemaTable.foreignKeys,
      tableName,
      namespaceId,
      tablePath,
      tableControlPolicy,
      issues,
      strict,
    );
    tableChildren.push(...fkStatuses);
  }

  const uniqueStatuses = verifyUniqueConstraints(
    contractTable.uniques,
    schemaTable.uniques,
    schemaTable.indexes,
    tableName,
    namespaceId,
    tablePath,
    tableControlPolicy,
    issues,
    strict,
  );
  tableChildren.push(...uniqueStatuses);

  // Combine user-declared indexes with FK-backing indexes (from FKs with index: true)
  // so the verifier treats FK-backing indexes as expected, not "extra".
  // Deduplicate: skip FK-backing indexes already covered by a user-declared index.
  const fkBackingIndexes = contractTable.foreignKeys
    .filter(
      (fk) =>
        fk.index === true &&
        !contractTable.indexes.some((idx) => arraysEqual(idx.columns, fk.source.columns)),
    )
    .map((fk) => ({ columns: fk.source.columns }));
  const allExpectedIndexes = [...contractTable.indexes, ...fkBackingIndexes];

  const indexStatuses = verifyIndexes(
    allExpectedIndexes,
    schemaTable.indexes,
    schemaTable.uniques,
    tableName,
    namespaceId,
    tablePath,
    tableControlPolicy,
    issues,
    strict,
  );
  tableChildren.push(...indexStatuses);

  // Verify check constraints when the contract declares checks for this table OR
  // when strict mode is on (so extra live checks on zero-check tables are detected).
  // schemaTable.checks carries the introspected live checks (parsed value sets).
  const contractCheckIRs = (contractTable.checks ?? []).map((c) => ({
    name: c.name,
    column: c.column,
    permittedValues: resolveValueSetValues(c.valueSet, contractStorage, `check "${c.name}"`),
  }));
  if (strict || contractCheckIRs.length > 0) {
    const checkStatuses = verifyCheckConstraints(
      contractCheckIRs,
      schemaTable.checks ?? [],
      tableName,
      namespaceId,
      tablePath,
      tableControlPolicy,
      issues,
      strict,
    );
    tableChildren.push(...checkStatuses);
  }

  return tableChildren;
}

function collectContractColumnNodes(options: {
  contractTable: StorageTable;
  schemaTable: SqlSchemaIR['tables'][string];
  tableName: string;
  namespaceId: string;
  tablePath: string;
  tableControlPolicy: ControlPolicy;
  issues: SchemaIssue[];
  strict: boolean;
  typeMetadataRegistry: ReadonlyMap<string, { nativeType?: string }>;
  codecHooks: Map<string, CodecControlHooks>;
  storageTypes: Readonly<Record<string, StorageTypeInstance>>;
  normalizeDefault?: DefaultNormalizer;
  normalizeNativeType?: NativeTypeNormalizer;
}): SchemaVerificationNode[] {
  const {
    contractTable,
    schemaTable,
    tableName,
    namespaceId,
    tablePath,
    tableControlPolicy,
    issues,
    strict,
    typeMetadataRegistry,
    codecHooks,
    storageTypes,
    normalizeDefault,
    normalizeNativeType,
  } = options;
  const columnNodes: SchemaVerificationNode[] = [];

  for (const [columnName, contractColumn] of Object.entries(contractTable.columns)) {
    const schemaColumn = schemaTable.columns[columnName];
    const columnPath = `${tablePath}.columns.${columnName}`;

    if (!schemaColumn) {
      const issue: SchemaIssue = {
        kind: 'missing_column',
        reason: 'not-found',
        table: tableName,
        namespaceId,
        column: columnName,
        message: `Column "${tableName}"."${columnName}" is missing from database`,
      };
      emitIssueAndNodeUnderControlPolicy(
        tableControlPolicy,
        issue,
        {
          status: 'fail',
          kind: 'column',
          name: `${columnName}: missing`,
          contractPath: columnPath,
          code: 'missing_column',
          message: `Column "${columnName}" is missing`,
          expected: undefined,
          actual: undefined,
          children: [],
        },
        issues,
        columnNodes,
      );
      continue;
    }

    columnNodes.push(
      verifyColumn({
        tableName,
        namespaceId,
        columnName,
        contractColumn,
        schemaColumn,
        columnPath,
        tableControlPolicy,
        issues,
        strict,
        typeMetadataRegistry,
        codecHooks,
        storageTypes,
        ...ifDefined('normalizeDefault', normalizeDefault),
        ...ifDefined('normalizeNativeType', normalizeNativeType),
      }),
    );
  }

  return columnNodes;
}

function appendExtraColumnNodes(options: {
  contractTable: StorageTable;
  schemaTable: SqlSchemaIR['tables'][string];
  tableName: string;
  namespaceId: string;
  tablePath: string;
  tableControlPolicy: ControlPolicy;
  issues: SchemaIssue[];
  columnNodes: SchemaVerificationNode[];
}): void {
  const {
    contractTable,
    schemaTable,
    tableName,
    namespaceId,
    tablePath,
    tableControlPolicy,
    issues,
    columnNodes,
  } = options;
  for (const [columnName, { nativeType }] of Object.entries(schemaTable.columns)) {
    if (!contractTable.columns[columnName]) {
      const issue: SchemaIssue = {
        kind: 'extra_column',
        reason: 'not-expected',
        table: tableName,
        namespaceId,
        column: columnName,
        message: `Extra column "${tableName}"."${columnName}" found in database (not in contract)`,
      };
      emitIssueAndNodeUnderControlPolicy(
        tableControlPolicy,
        issue,
        {
          status: 'fail',
          kind: 'column',
          name: `${columnName}: extra`,
          contractPath: `${tablePath}.columns.${columnName}`,
          code: 'extra_column',
          message: `Extra column "${columnName}" found`,
          expected: undefined,
          actual: nativeType,
          children: [],
        },
        issues,
        columnNodes,
      );
    }
  }
}

function verifyColumn(options: {
  tableName: string;
  namespaceId: string;
  columnName: string;
  contractColumn: StorageTable['columns'][string];
  schemaColumn: SqlSchemaIR['tables'][string]['columns'][string];
  columnPath: string;
  tableControlPolicy: ControlPolicy;
  issues: SchemaIssue[];
  strict: boolean;
  typeMetadataRegistry: ReadonlyMap<string, { nativeType?: string }>;
  codecHooks: Map<string, CodecControlHooks>;
  storageTypes: Readonly<Record<string, StorageTypeInstance>>;
  normalizeDefault?: DefaultNormalizer;
  normalizeNativeType?: NativeTypeNormalizer;
}): SchemaVerificationNode {
  const {
    tableName,
    namespaceId,
    columnName,
    contractColumn,
    schemaColumn,
    columnPath,
    tableControlPolicy,
    issues,
    strict,
    codecHooks,
    storageTypes,
    normalizeDefault,
    normalizeNativeType,
  } = options;
  const columnChildren: SchemaVerificationNode[] = [];
  let columnStatus: VerificationStatus = 'pass';

  const resolvedContractColumn = resolveContractColumnTypeMetadata(contractColumn, storageTypes, {
    tableName,
    columnName,
  });
  const contractNativeType = renderExpectedNativeType(contractColumn, storageTypes, codecHooks, {
    tableName,
    columnName,
  });
  const schemaBaseNativeType =
    normalizeNativeType?.(schemaColumn.nativeType) ?? schemaColumn.nativeType;
  const schemaNativeType = schemaColumn.many ? `${schemaBaseNativeType}[]` : schemaBaseNativeType;

  const typesMatch = contractNativeType === schemaNativeType;

  if (!typesMatch) {
    const issue: SchemaIssue = {
      kind: 'type_mismatch',
      reason: 'not-equal',
      table: tableName,
      namespaceId,
      column: columnName,
      expected: contractNativeType,
      actual: schemaNativeType,
      message: `Column "${tableName}"."${columnName}" has type mismatch: expected "${contractNativeType}", got "${schemaNativeType}"`,
    };
    const disposition = verifierDisposition(tableControlPolicy, issue.kind);
    if (disposition !== 'suppress') {
      issues.push(issue);
      columnChildren.push({
        status: disposition,
        kind: 'type',
        name: 'type',
        contractPath: `${columnPath}.nativeType`,
        code: 'type_mismatch',
        message: `Type mismatch: expected ${contractNativeType}, got ${schemaNativeType}`,
        expected: contractNativeType,
        actual: schemaNativeType,
        children: [],
      });
      columnStatus = disposition;
    }
  }

  if (resolvedContractColumn.codecId) {
    const typeMetadata = options.typeMetadataRegistry.get(resolvedContractColumn.codecId);
    if (!typeMetadata) {
      columnChildren.push({
        status: 'warn',
        kind: 'type',
        name: 'type_metadata_missing',
        contractPath: `${columnPath}.codecId`,
        code: 'type_metadata_missing',
        message: `codecId "${resolvedContractColumn.codecId}" not found in type metadata registry`,
        expected: resolvedContractColumn.codecId,
        actual: undefined,
        children: [],
      });
    } else if (
      typeMetadata.nativeType &&
      typeMetadata.nativeType !== resolvedContractColumn.nativeType
    ) {
      columnChildren.push({
        status: 'warn',
        kind: 'type',
        name: 'type_consistency',
        contractPath: `${columnPath}.codecId`,
        code: 'type_consistency_warning',
        message: `codecId "${resolvedContractColumn.codecId}" maps to nativeType "${typeMetadata.nativeType}" in registry, but contract has "${resolvedContractColumn.nativeType}"`,
        expected: typeMetadata.nativeType,
        actual: resolvedContractColumn.nativeType,
        children: [],
      });
    }
  }

  if (contractColumn.nullable !== schemaColumn.nullable) {
    const issue: SchemaIssue = {
      kind: 'nullability_mismatch',
      reason: 'not-equal',
      table: tableName,
      namespaceId,
      column: columnName,
      expected: String(contractColumn.nullable),
      actual: String(schemaColumn.nullable),
      message: `Column "${tableName}"."${columnName}" has nullability mismatch: expected ${contractColumn.nullable ? 'nullable' : 'not null'}, got ${schemaColumn.nullable ? 'nullable' : 'not null'}`,
    };
    const disposition = verifierDisposition(tableControlPolicy, issue.kind);
    if (disposition !== 'suppress') {
      issues.push(issue);
      columnChildren.push({
        status: disposition,
        kind: 'nullability',
        name: 'nullability',
        contractPath: `${columnPath}.nullable`,
        code: 'nullability_mismatch',
        message: `Nullability mismatch: expected ${contractColumn.nullable ? 'nullable' : 'not null'}, got ${schemaColumn.nullable ? 'nullable' : 'not null'}`,
        expected: contractColumn.nullable,
        actual: schemaColumn.nullable,
        children: [],
      });
      columnStatus = disposition;
    }
  }

  if (contractColumn.default) {
    if (!schemaColumn.default) {
      const defaultDescription = describeColumnDefault(contractColumn.default);
      const issue: SchemaIssue = {
        kind: 'default_missing',
        reason: 'not-found',
        table: tableName,
        namespaceId,
        column: columnName,
        expected: defaultDescription,
        message: `Column "${tableName}"."${columnName}" should have default ${defaultDescription} but database has no default`,
      };
      const disposition = verifierDisposition(tableControlPolicy, issue.kind);
      if (disposition !== 'suppress') {
        issues.push(issue);
        columnChildren.push({
          status: disposition,
          kind: 'default',
          name: 'default',
          contractPath: `${columnPath}.default`,
          code: 'default_missing',
          message: `Default missing: expected ${defaultDescription}`,
          expected: defaultDescription,
          actual: undefined,
          children: [],
        });
        columnStatus = disposition;
      }
    } else if (
      !columnDefaultsEqual(
        contractColumn.default,
        schemaColumn.default,
        normalizeDefault,
        schemaNativeType,
      )
    ) {
      const expectedDescription = describeColumnDefault(contractColumn.default);
      const actualDescription = schemaColumn.default;
      const issue: SchemaIssue = {
        kind: 'default_mismatch',
        reason: 'not-equal',
        table: tableName,
        namespaceId,
        column: columnName,
        expected: expectedDescription,
        actual: actualDescription,
        message: `Column "${tableName}"."${columnName}" has default mismatch: expected ${expectedDescription}, got ${actualDescription}`,
      };
      const disposition = verifierDisposition(tableControlPolicy, issue.kind);
      if (disposition !== 'suppress') {
        issues.push(issue);
        columnChildren.push({
          status: disposition,
          kind: 'default',
          name: 'default',
          contractPath: `${columnPath}.default`,
          code: 'default_mismatch',
          message: `Default mismatch: expected ${expectedDescription}, got ${actualDescription}`,
          expected: expectedDescription,
          actual: actualDescription,
          children: [],
        });
        columnStatus = disposition;
      }
    }
  } else if (strict && schemaColumn.default) {
    const issue: SchemaIssue = {
      kind: 'extra_default',
      reason: 'not-expected',
      table: tableName,
      namespaceId,
      column: columnName,
      actual: schemaColumn.default,
      message: `Column "${tableName}"."${columnName}" has default ${schemaColumn.default} in database but contract specifies no default`,
    };
    const disposition = verifierDisposition(tableControlPolicy, issue.kind);
    if (disposition !== 'suppress') {
      issues.push(issue);
      columnChildren.push({
        status: disposition,
        kind: 'default',
        name: 'default',
        contractPath: `${columnPath}.default`,
        code: 'extra_default',
        message: `Extra default: ${schemaColumn.default}`,
        expected: undefined,
        actual: schemaColumn.default,
        children: [],
      });
      columnStatus = disposition;
    }
  }

  // Single-pass aggregation for better performance
  const aggregated = aggregateChildState(columnChildren, columnStatus);
  const nullableText = contractColumn.nullable ? 'nullable' : 'not nullable';
  const columnTypeDisplay = resolvedContractColumn.codecId
    ? `${contractNativeType} (${resolvedContractColumn.codecId})`
    : contractNativeType;
  const columnMessage = aggregated.failureMessages.join('; ');

  return {
    status: aggregated.status,
    kind: 'column',
    name: `${columnName}: ${columnTypeDisplay} (${nullableText})`,
    contractPath: columnPath,
    code: aggregated.firstCode,
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
    status: aggregateChildState(columnNodes, 'pass').status,
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
  const tableStatus = aggregateChildState(tableChildren, 'pass').status;
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
    status: aggregateChildState(rootChildren, 'pass').status,
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

/**
 * Aggregated state from child nodes, computed in a single pass.
 */
interface AggregatedChildState {
  readonly status: VerificationStatus;
  readonly failureMessages: readonly string[];
  readonly firstCode: string;
}

/**
 * Aggregates status, failure messages, and code from children in a single pass.
 * This is more efficient than calling separate functions that each iterate the array.
 */
function aggregateChildState(
  children: SchemaVerificationNode[],
  fallback: VerificationStatus,
): AggregatedChildState {
  let status: VerificationStatus = fallback;
  const failureMessages: string[] = [];
  let firstCode = '';

  for (const child of children) {
    if (child.status === 'fail') {
      status = 'fail';
      if (!firstCode) {
        firstCode = child.code;
      }
      if (child.message && typeof child.message === 'string' && child.message.length > 0) {
        failureMessages.push(child.message);
      }
    } else if (child.status === 'warn' && status !== 'fail') {
      status = 'warn';
      if (!firstCode) {
        firstCode = child.code;
      }
    }
  }

  return { status, failureMessages, firstCode };
}

function validateFrameworkComponentsForExtensions(
  contract: Contract<SqlStorage>,
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
 * Renders the expected native type for a contract column, expanding parameterized types
 * using codec control hooks when available.
 *
 * This function delegates to the `expandNativeType` hook if the codec provides one,
 * ensuring that the SQL family layer remains dialect-agnostic while allowing
 * target-specific adapters (like Postgres) to provide their own expansion logic.
 */
function renderExpectedNativeType(
  contractColumn: StorageColumn,
  storageTypes: Readonly<Record<string, StorageTypeInstance>>,
  codecHooks: Map<string, CodecControlHooks>,
  context?: {
    readonly tableName: string;
    readonly columnName: string;
  },
): string {
  const { codecId, nativeType, typeParams } = resolveContractColumnTypeMetadata(
    contractColumn,
    storageTypes,
    context,
  );

  let baseType: string;

  // If no typeParams or codecId, return the base native type
  if (!typeParams || !codecId) {
    baseType = nativeType;
  } else {
    // Try to use the codec's expandNativeType hook if available
    const hooks = codecHooks.get(codecId);
    baseType = hooks?.expandNativeType
      ? hooks.expandNativeType({ nativeType, codecId, typeParams })
      : nativeType;
  }

  return contractColumn.many ? `${baseType}[]` : baseType;
}

function resolveContractColumnTypeMetadata(
  contractColumn: StorageColumn,
  storageTypes: Readonly<Record<string, StorageTypeInstance>>,
  context?: {
    readonly tableName: string;
    readonly columnName: string;
  },
): Pick<StorageColumn, 'codecId' | 'nativeType' | 'typeParams'> {
  if (!contractColumn.typeRef) {
    return contractColumn;
  }

  const referencedType = storageTypes[contractColumn.typeRef];
  if (!referencedType) {
    const columnLabel = context
      ? `Column "${context.tableName}"."${context.columnName}"`
      : 'Column';
    throw new Error(
      `${columnLabel} references storage type "${contractColumn.typeRef}" but it is not defined in storage.types.`,
    );
  }

  if (isStorageTypeInstance(referencedType)) {
    return {
      codecId: referencedType.codecId,
      nativeType: referencedType.nativeType,
      typeParams: referencedType.typeParams,
    };
  }
  throw new Error(
    `Storage type "${contractColumn.typeRef}" has an unknown kind; expected a codec-typed StorageTypeInstance.`,
  );
}

/**
 * Describes a column default for display purposes.
 */
function describeColumnDefault(columnDefault: ColumnDefault): string {
  switch (columnDefault.kind) {
    case 'literal':
      return `literal(${formatLiteralValue(columnDefault.value)})`;
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
    if (contractDefault.kind === 'function') {
      return contractDefault.expression === schemaDefault;
    }
    const normalizedValue = normalizeLiteralValue(contractDefault.value, nativeType);
    if (typeof normalizedValue === 'string') {
      return normalizedValue === schemaDefault || `'${normalizedValue}'` === schemaDefault;
    }
    return String(normalizedValue) === schemaDefault;
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
    const contractValue = normalizeLiteralValue(contractDefault.value, nativeType);
    const schemaValue = normalizeLiteralValue(normalizedSchema.value, nativeType);
    return literalValuesEqual(contractValue, schemaValue);
  }
  if (contractDefault.kind === 'function' && normalizedSchema.kind === 'function') {
    // Normalize function expressions for comparison (case-insensitive, whitespace-tolerant)
    const normalizeExpr = (expr: string) => expr.toLowerCase().replace(/\s+/g, '');
    return normalizeExpr(contractDefault.expression) === normalizeExpr(normalizedSchema.expression);
  }
  return false;
}

function isTemporalNativeType(nativeType?: string): boolean {
  if (!nativeType) return false;
  const normalized = nativeType.toLowerCase();
  return normalized.includes('timestamp') || normalized === 'date';
}

function normalizeLiteralValue(value: unknown, nativeType?: string): unknown {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'string' && isTemporalNativeType(nativeType)) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }
  return value;
}

function literalValuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === 'object' && a !== null && typeof b === 'object' && b !== null) {
    return canonicalStringify(a) === canonicalStringify(b);
  }
  if (typeof a === 'object' && a !== null && typeof b === 'string') {
    try {
      return canonicalStringify(a) === canonicalStringify(JSON.parse(b));
    } catch {
      return false;
    }
  }
  if (typeof a === 'string' && typeof b === 'object' && b !== null) {
    try {
      return canonicalStringify(JSON.parse(a)) === canonicalStringify(b);
    } catch {
      return false;
    }
  }
  return false;
}

function formatLiteralValue(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'string') {
    return value;
  }
  return JSON.stringify(value);
}

/**
 * Reads a namespace node's DDL schema name. Namespaced target nodes (Postgres
 * `PostgresNamespaceSchemaNode`) carry `schemaName`; a flat schema (SQLite) has
 * none and pairs by position as the sole namespace.
 */
function namespaceSchemaName(node: SqlSchemaIR): string | undefined {
  return blindCast<
    { readonly schemaName?: string },
    'reading the optional namespace schemaName off a per-schema node'
  >(node).schemaName;
}

/**
 * Returns a shallow copy of `contract` exposing only the one named namespace —
 * used solely to resolve that namespace's live DDL schema via the target's
 * expected-tree projection (never for verification, so global value-sets it may
 * reference are not consulted).
 */
function scopeContractToNamespace(
  contract: Contract<SqlStorage>,
  namespaceId: string,
): Contract<SqlStorage> {
  const namespace = contract.storage.namespaces[namespaceId];
  const scopedNamespaces = namespace === undefined ? {} : { [namespaceId]: namespace };
  return blindCast<
    Contract<SqlStorage>,
    'narrowing storage.namespaces to one entry; the rest of the contract is preserved'
  >({
    ...contract,
    storage: blindCast<
      SqlStorage,
      'shallow storage copy with a single-namespace map; other storage fields are preserved'
    >({
      ...contract.storage,
      namespaces: scopedNamespaces,
    }),
  });
}

/**
 * Combines two `VerifyDatabaseSchemaResult`s by concatenating issues and summing
 * counts — used to fold the per-namespace pairings of a multi-schema database
 * into one result. The verification-tree `root` of the first pairing is
 * retained (multi-schema verify-tree shaping is future work).
 */
function mergeVerifyResults(
  a: VerifyDatabaseSchemaResult,
  b: VerifyDatabaseSchemaResult,
): VerifyDatabaseSchemaResult {
  return {
    ...a,
    ok: a.ok && b.ok,
    ...ifDefined('code', a.code ?? b.code),
    schema: {
      ...a.schema,
      issues: [...a.schema.issues, ...b.schema.issues],
      schemaDiffIssues: [...a.schema.schemaDiffIssues, ...b.schema.schemaDiffIssues],
      counts: {
        pass: a.schema.counts.pass + b.schema.counts.pass,
        warn: a.schema.counts.warn + b.schema.counts.warn,
        fail: a.schema.counts.fail + b.schema.counts.fail,
        totalNodes: a.schema.counts.totalNodes + b.schema.counts.totalNodes,
      },
    },
  };
}

/**
 * The single per-namespace-paired relational verify shared by the migration
 * planner and the family schema verify — there is exactly one such operation.
 *
 * Each contract namespace is paired to the introspected namespace node holding
 * the same DDL schema, then `verifySqlSchema` checks that namespace's tables
 * against the matching actual node (a contract table under `auth` is only ever
 * looked up in the `auth` actual node, so a multi-schema database no longer
 * reports tables in other schemas as missing). The full contract is passed every
 * time — `restrictToNamespaceIds` scopes only which tables are checked, so
 * cross-namespace value-set / control-policy resolution is unaffected.
 *
 * The DDL schema of each contract namespace is read from a single-namespace
 * expected projection (`buildExpectedSchema`), which both callers already build
 * the same way. Empty contract namespaces verify nothing and are skipped.
 * Single-schema (one namespace) and SQLite's flat schema are one pairing —
 * byte-identical to the prior per-node verify.
 */
export function verifySqlSchemaTree(options: {
  readonly contract: Contract<SqlStorage>;
  readonly actualSchema: SqlSchemaIRNode;
  readonly buildExpectedSchema: (contract: Contract<SqlStorage>) => SqlSchemaIRNode;
  readonly strict: boolean;
  readonly typeMetadataRegistry: ReadonlyMap<string, { nativeType?: string }>;
  readonly frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<'sql', string>>;
  readonly normalizeDefault?: DefaultNormalizer;
  readonly normalizeNativeType?: NativeTypeNormalizer;
}): VerifyDatabaseSchemaResult {
  const baseOptions = {
    contract: options.contract,
    strict: options.strict,
    typeMetadataRegistry: options.typeMetadataRegistry,
    frameworkComponents: options.frameworkComponents,
    ...ifDefined('normalizeDefault', options.normalizeDefault),
    ...ifDefined('normalizeNativeType', options.normalizeNativeType),
  };

  const actualNodes = namespaceSchemaNodes(options.actualSchema);
  const actualByName = new Map<string, SqlSchemaIR>();
  for (const node of actualNodes) {
    const name = namespaceSchemaName(node);
    if (name !== undefined) actualByName.set(name, node);
  }
  // A flat actual schema (SQLite) has no named namespaces — it is the sole node.
  const soleFlatActual = actualByName.size === 0 ? actualNodes[0] : undefined;
  const emptyNamespace: SqlSchemaIR = { tables: {} };

  let combined: VerifyDatabaseSchemaResult | undefined;
  for (const namespaceId of Object.keys(options.contract.storage.namespaces)) {
    const namespace = options.contract.storage.namespaces[namespaceId];
    if (!namespace || Object.keys(namespace.entries.table ?? {}).length === 0) continue;

    const ddlSchema = namespaceSchemaNodes(
      options.buildExpectedSchema(scopeContractToNamespace(options.contract, namespaceId)),
    )
      .map(namespaceSchemaName)
      .find((name) => name !== undefined);
    const actualNode =
      (ddlSchema !== undefined ? actualByName.get(ddlSchema) : soleFlatActual) ?? emptyNamespace;

    const result = verifySqlSchema({
      ...baseOptions,
      schema: actualNode,
      restrictToNamespaceIds: new Set([namespaceId]),
    });
    combined = combined === undefined ? result : mergeVerifyResults(combined, result);
  }

  return combined ?? verifySqlSchema({ ...baseOptions, schema: emptyNamespace });
}
