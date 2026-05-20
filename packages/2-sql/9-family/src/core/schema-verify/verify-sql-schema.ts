/**
 * Pure SQL schema verification function.
 *
 * This module provides a pure function that verifies a SqlSchemaIR against
 * a Contract without requiring a database connection. It can be reused
 * by migration planners and other tools that need to compare schema states.
 */

import type { Contract, JsonValue } from '@prisma-next/contract/types';
import type { CodecLookup } from '@prisma-next/framework-components/codec';
import type { TargetBoundComponentDescriptor } from '@prisma-next/framework-components/components';
import type {
  OperationContext,
  SchemaIssue,
  SchemaVerificationNode,
  VerifyDatabaseSchemaResult,
} from '@prisma-next/framework-components/control';
import type { ColumnDefault } from '@prisma-next/sql-contract/types';
import {
  isPostgresEnumStorageEntry,
  isStorageTypeInstance,
  type PostgresEnumStorageEntry,
  type SqlStorage,
  type StorageColumn,
  StorageTable,
  type StorageTypeInstance,
} from '@prisma-next/sql-contract/types';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import { ifDefined } from '@prisma-next/utils/defined';
import { extractCodecControlHooks } from '../assembly';
import type { CodecControlHooks } from '../migrations/types';
import {
  arraysEqual,
  computeCounts,
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
 * Function type for normalizing schema native types to canonical form for comparison.
 * Target-specific implementations handle dialect-specific type name variations
 * (e.g., Postgres 'varchar' → 'character varying', 'timestamptz' normalization).
 */
export type NativeTypeNormalizer = (nativeType: string) => string;

/**
 * Function type for parsing a raw schema-side SQL default expression into a
 * codec-comparable {@link JsonValue}.
 *
 * Returns `undefined` when the raw expression is not a simple literal
 * (e.g. function-form like `now()`, autoincrement `nextval(...)`); the
 * verifier then falls back to the legacy normalizer-based string compare
 * path for those cases.
 *
 * For literal forms, the parser strips the dialect's casts (`::type`),
 * unquotes string literals, parses bare numerics / booleans, and normalises
 * dialect-specific value shapes (e.g. Postgres's space-separated
 * `'2024-01-15 10:30:00+00'` timestamps to ISO-8601 UTC) so the codec's
 * strict `decodeJson` accepts the result.
 *
 * The verifier dispatches the returned value through `codec.decodeJson` →
 * `codec.renderSqlLiteral` to produce a contract-canonical expression that
 * compares cleanly against `contract.default.expression`.
 */
export type SchemaDefaultValueParser = (
  rawDefault: string,
  nativeType: string,
) => JsonValue | undefined;

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
   * Bridging adapter that resolves the existing values for a `PostgresEnumStorageEntry`
   * (looked up by its native type) from the introspected schema IR. Targets
   * supply this so the family-level verifier can walk `PostgresEnumStorageEntry` instances
   * natively without reaching into target-specific `schema.annotations`
   * shapes itself.
   *
   * Returning `null` indicates the type is missing from the database; the
   * verifier emits a `type_missing` issue. A non-null array triggers a
   * value-set comparison against the contract's `PostgresEnumStorageEntry.values`.
   */
  readonly resolveExistingEnumValues?: (
    schema: SqlSchemaIR,
    enumType: PostgresEnumStorageEntry,
  ) => readonly string[] | null;
  /**
   * Codec-id-keyed lookup used by the codec-aware default comparison path.
   *
   * Threaded alongside {@link SchemaDefaultValueParser}: when both are
   * supplied and the column carries a known `codecId`, the verifier
   * round-trips the introspected literal through `codec.decodeJson` →
   * `codec.renderSqlLiteral` and compares the canonical contract-side form
   * against `contract.default.expression`. When either input is missing —
   * or the column's codec is not in the lookup — the verifier falls back to
   * the legacy {@link DefaultNormalizer} string-compare path.
   *
   * Production call sites (Postgres / SQLite planners and runners) build
   * this via {@link extractCodecLookup} over the same `frameworkComponents`
   * they already pass to the verifier.
   */
  readonly codecLookup?: CodecLookup;
  /**
   * Per-target parser that extracts the codec-comparable {@link JsonValue}
   * out of a raw schema-side default expression. See
   * {@link SchemaDefaultValueParser} for the contract.
   */
  readonly parseSchemaDefaultValue?: SchemaDefaultValueParser;
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
    resolveExistingEnumValues,
    codecLookup,
    parseSchemaDefaultValue,
  } = options;
  const startTime = Date.now();

  // Extract codec control hooks once at entry point for reuse
  const codecHooks = extractCodecControlHooks(options.frameworkComponents);

  const { contractStorageHash, contractProfileHash, contractTarget } =
    extractContractMetadata(contract);
  const allStorageTypesMap: Record<string, PostgresEnumStorageEntry | StorageTypeInstance> = {
    ...((contract.storage.types ?? {}) as Record<
      string,
      PostgresEnumStorageEntry | StorageTypeInstance
    >),
  };
  for (const ns of Object.values(contract.storage.namespaces)) {
    const nsTypes = (ns as { types?: Record<string, PostgresEnumStorageEntry> }).types;
    if (nsTypes) {
      for (const [k, v] of Object.entries(nsTypes)) {
        allStorageTypesMap[k] = v;
      }
    }
  }
  const storageTypes = allStorageTypesMap as Readonly<
    Record<string, PostgresEnumStorageEntry | StorageTypeInstance>
  >;
  const { issues, rootChildren } = verifySchemaTables({
    contract,
    schema,
    strict,
    typeMetadataRegistry,
    codecHooks,
    storageTypes,
    ...ifDefined('normalizeDefault', normalizeDefault),
    ...ifDefined('normalizeNativeType', normalizeNativeType),
    ...ifDefined('codecLookup', codecLookup),
    ...ifDefined('parseSchemaDefaultValue', parseSchemaDefaultValue),
  });

  validateFrameworkComponentsForExtensions(contract, options.frameworkComponents);

  // Verify storage type instances. PostgresEnumStorageEntry entries are walked
  // natively (using the bridging adapter `resolveExistingEnumValues`);
  // remaining codec-typed entries continue to dispatch through the
  // generic codec-hook `verifyType` path.
  const storageTypeEntries = Object.entries(storageTypes);
  if (storageTypeEntries.length > 0) {
    const typeNodes: SchemaVerificationNode[] = [];
    for (const [typeName, typeInstance] of storageTypeEntries) {
      let typeIssues: readonly SchemaIssue[];
      if (isPostgresEnumStorageEntry(typeInstance)) {
        typeIssues = verifyEnumType({
          typeName,
          typeInstance,
          schema,
          resolveExistingEnumValues,
        });
      } else if (isStorageTypeInstance(typeInstance)) {
        const hook = codecHooks.get(typeInstance.codecId);
        typeIssues = hook?.verifyType ? hook.verifyType({ typeName, typeInstance, schema }) : [];
      } else {
        typeIssues = [];
      }
      if (typeIssues.length > 0) {
        issues.push(...typeIssues);
      }
      const typeStatus = typeIssues.length > 0 ? 'fail' : 'pass';
      const typeCode = typeIssues.length > 0 ? (typeIssues[0]?.kind ?? '') : '';
      typeNodes.push({
        status: typeStatus,
        kind: 'storageType',
        name: `type ${typeName}`,
        contractPath: `storage.types.${typeName}`,
        code: typeCode,
        message:
          typeIssues.length > 0
            ? `${typeIssues.length} issue${typeIssues.length === 1 ? '' : 's'}`
            : '',
        expected: undefined,
        actual: undefined,
        children: [],
      });
    }
    const typesStatus = typeNodes.some((n) => n.status === 'fail') ? 'fail' : 'pass';
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

/**
 * Native verification walk for `PostgresEnumStorageEntry` instances (no codec hook).
 *
 * Bridges the native `PostgresEnumStorageEntry.values` against the introspected schema
 * IR via the target-supplied `resolveExistingEnumValues` adapter. Without an
 * adapter, the verifier conservatively reports the enum as missing — there
 * is no other way for the family layer to learn about live enum types.
 */
function verifyEnumType(options: {
  readonly typeName: string;
  readonly typeInstance: PostgresEnumStorageEntry;
  readonly schema: SqlSchemaIR;
  readonly resolveExistingEnumValues?:
    | ((schema: SqlSchemaIR, enumType: PostgresEnumStorageEntry) => readonly string[] | null)
    | undefined;
}): readonly SchemaIssue[] {
  const { typeName, typeInstance, schema, resolveExistingEnumValues } = options;
  const desired = typeInstance.values;
  const existing = resolveExistingEnumValues?.(schema, typeInstance) ?? null;
  if (!existing) {
    return [
      {
        kind: 'type_missing',
        typeName,
        message: `Type "${typeName}" is missing from database`,
      },
    ];
  }
  if (arraysEqual(existing, desired)) {
    return [];
  }
  const existingSet = new Set(existing);
  const desiredSet = new Set(desired);
  const addedValues = desired.filter((v) => !existingSet.has(v));
  const removedValues = existing.filter((v) => !desiredSet.has(v));
  const message =
    removedValues.length === 0
      ? `Enum type "${typeName}" needs new values: ${addedValues.join(', ')}`
      : `Enum type "${typeName}" values changed (requires rebuild): +[${addedValues.join(', ')}] -[${removedValues.join(', ')}]`;
  return [
    {
      kind: 'enum_values_changed' as const,
      typeName,
      addedValues,
      removedValues,
      message,
    },
  ];
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
  storageTypes: Readonly<Record<string, StorageTypeInstance | PostgresEnumStorageEntry>>;
  normalizeDefault?: DefaultNormalizer;
  normalizeNativeType?: NativeTypeNormalizer;
  codecLookup?: CodecLookup;
  parseSchemaDefaultValue?: SchemaDefaultValueParser;
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
    codecLookup,
    parseSchemaDefaultValue,
  } = options;
  const issues: SchemaIssue[] = [];
  const rootChildren: SchemaVerificationNode[] = [];
  const schemaTables = schema.tables;
  const namespaceIds = Object.keys(contract.storage.namespaces).sort((a, b) =>
    a < b ? -1 : a > b ? 1 : 0,
  );

  for (const namespaceId of namespaceIds) {
    const ns = contract.storage.namespaces[namespaceId];
    if (!ns) continue;
    for (const [tableName, contractTableRaw] of Object.entries(ns.tables)) {
      if (!(contractTableRaw instanceof StorageTable)) {
        throw new Error(
          `verifySqlSchema: expected StorageTable at storage.namespaces.${namespaceId}.tables.${tableName}`,
        );
      }
      const contractTable = contractTableRaw;
      const schemaTable = schemaTables[tableName];
      const tablePath = `storage.namespaces.${namespaceId}.tables.${tableName}`;

      if (!schemaTable) {
        issues.push({
          kind: 'missing_table',
          table: tableName,
          namespaceId,
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
        namespaceId,
        tablePath,
        issues,
        strict,
        typeMetadataRegistry,
        codecHooks,
        storageTypes,
        ...ifDefined('normalizeDefault', normalizeDefault),
        ...ifDefined('normalizeNativeType', normalizeNativeType),
        ...ifDefined('codecLookup', codecLookup),
        ...ifDefined('parseSchemaDefaultValue', parseSchemaDefaultValue),
      });
      rootChildren.push(buildTableNode(tableName, tablePath, tableChildren));
    }
  }

  if (strict) {
    for (const tableName of Object.keys(schemaTables)) {
      const claimed = namespaceIds.some(
        (namespaceId) => contract.storage.namespaces[namespaceId]?.tables[tableName] !== undefined,
      );
      if (!claimed) {
        // `namespaceId` is intentionally absent: an extra table exists in the
        // live database but is not claimed by any contract namespace, so there
        // is no contract coordinate to stamp here. Planners that consume this
        // issue must handle the unstamped case (drop / quarantine by name).
        issues.push({
          kind: 'extra_table',
          table: tableName,
          message: `Extra table "${tableName}" found in database (not in contract)`,
        });
        rootChildren.push({
          status: 'fail',
          kind: 'table',
          name: `table ${tableName}`,
          contractPath: `storage.namespaces.*.tables.${tableName}`,
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
  contractTable: StorageTable;
  schemaTable: SqlSchemaIR['tables'][string];
  tableName: string;
  namespaceId: string;
  tablePath: string;
  issues: SchemaIssue[];
  strict: boolean;
  typeMetadataRegistry: ReadonlyMap<string, { nativeType?: string }>;
  codecHooks: Map<string, CodecControlHooks>;
  storageTypes: Readonly<Record<string, StorageTypeInstance | PostgresEnumStorageEntry>>;
  normalizeDefault?: DefaultNormalizer;
  normalizeNativeType?: NativeTypeNormalizer;
  codecLookup?: CodecLookup;
  parseSchemaDefaultValue?: SchemaDefaultValueParser;
}): SchemaVerificationNode[] {
  const {
    contractTable,
    schemaTable,
    tableName,
    namespaceId,
    tablePath,
    issues,
    strict,
    typeMetadataRegistry,
    codecHooks,
    storageTypes,
    normalizeDefault,
    normalizeNativeType,
    codecLookup,
    parseSchemaDefaultValue,
  } = options;
  const tableChildren: SchemaVerificationNode[] = [];
  const columnNodes = collectContractColumnNodes({
    contractTable,
    schemaTable,
    tableName,
    namespaceId,
    tablePath,
    issues,
    strict,
    typeMetadataRegistry,
    codecHooks,
    storageTypes,
    ...ifDefined('normalizeDefault', normalizeDefault),
    ...ifDefined('normalizeNativeType', normalizeNativeType),
    ...ifDefined('codecLookup', codecLookup),
    ...ifDefined('parseSchemaDefaultValue', parseSchemaDefaultValue),
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
      namespaceId,
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
    issues,
    strict,
  );
  tableChildren.push(...indexStatuses);

  return tableChildren;
}

function collectContractColumnNodes(options: {
  contractTable: StorageTable;
  schemaTable: SqlSchemaIR['tables'][string];
  tableName: string;
  namespaceId: string;
  tablePath: string;
  issues: SchemaIssue[];
  strict: boolean;
  typeMetadataRegistry: ReadonlyMap<string, { nativeType?: string }>;
  codecHooks: Map<string, CodecControlHooks>;
  storageTypes: Readonly<Record<string, StorageTypeInstance | PostgresEnumStorageEntry>>;
  normalizeDefault?: DefaultNormalizer;
  normalizeNativeType?: NativeTypeNormalizer;
  codecLookup?: CodecLookup;
  parseSchemaDefaultValue?: SchemaDefaultValueParser;
}): SchemaVerificationNode[] {
  const {
    contractTable,
    schemaTable,
    tableName,
    namespaceId,
    tablePath,
    issues,
    strict,
    typeMetadataRegistry,
    codecHooks,
    storageTypes,
    normalizeDefault,
    normalizeNativeType,
    codecLookup,
    parseSchemaDefaultValue,
  } = options;
  const columnNodes: SchemaVerificationNode[] = [];

  for (const [columnName, contractColumn] of Object.entries(contractTable.columns)) {
    const schemaColumn = schemaTable.columns[columnName];
    const columnPath = `${tablePath}.columns.${columnName}`;

    if (!schemaColumn) {
      issues.push({
        kind: 'missing_column',
        table: tableName,
        namespaceId,
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
        namespaceId,
        columnName,
        contractColumn,
        schemaColumn,
        columnPath,
        issues,
        strict,
        typeMetadataRegistry,
        codecHooks,
        storageTypes,
        ...ifDefined('normalizeDefault', normalizeDefault),
        ...ifDefined('normalizeNativeType', normalizeNativeType),
        ...ifDefined('codecLookup', codecLookup),
        ...ifDefined('parseSchemaDefaultValue', parseSchemaDefaultValue),
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
  issues: SchemaIssue[];
  columnNodes: SchemaVerificationNode[];
}): void {
  const { contractTable, schemaTable, tableName, namespaceId, tablePath, issues, columnNodes } =
    options;
  for (const [columnName, { nativeType }] of Object.entries(schemaTable.columns)) {
    if (!contractTable.columns[columnName]) {
      issues.push({
        kind: 'extra_column',
        table: tableName,
        namespaceId,
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
  namespaceId: string;
  columnName: string;
  contractColumn: StorageTable['columns'][string];
  schemaColumn: SqlSchemaIR['tables'][string]['columns'][string];
  columnPath: string;
  issues: SchemaIssue[];
  strict: boolean;
  typeMetadataRegistry: ReadonlyMap<string, { nativeType?: string }>;
  codecHooks: Map<string, CodecControlHooks>;
  storageTypes: Readonly<Record<string, StorageTypeInstance | PostgresEnumStorageEntry>>;
  normalizeDefault?: DefaultNormalizer;
  normalizeNativeType?: NativeTypeNormalizer;
  codecLookup?: CodecLookup;
  parseSchemaDefaultValue?: SchemaDefaultValueParser;
}): SchemaVerificationNode {
  const {
    tableName,
    namespaceId,
    columnName,
    contractColumn,
    schemaColumn,
    columnPath,
    issues,
    strict,
    codecHooks,
    storageTypes,
    normalizeDefault,
    normalizeNativeType,
    codecLookup,
    parseSchemaDefaultValue,
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
  const schemaNativeType =
    normalizeNativeType?.(schemaColumn.nativeType) ?? schemaColumn.nativeType;

  if (contractNativeType !== schemaNativeType) {
    issues.push({
      kind: 'type_mismatch',
      table: tableName,
      namespaceId,
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
    issues.push({
      kind: 'nullability_mismatch',
      table: tableName,
      namespaceId,
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
        namespaceId,
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
        resolvedContractColumn.codecId
          ? codecLookup?.get(resolvedContractColumn.codecId)
          : undefined,
        parseSchemaDefaultValue,
      )
    ) {
      const expectedDescription = describeColumnDefault(contractColumn.default);
      // schemaColumn.default is now a raw string, describe it as-is
      const actualDescription = schemaColumn.default;
      issues.push({
        kind: 'default_mismatch',
        table: tableName,
        namespaceId,
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
  } else if (strict && schemaColumn.default) {
    issues.push({
      kind: 'extra_default',
      table: tableName,
      namespaceId,
      column: columnName,
      actual: schemaColumn.default,
      message: `Column "${tableName}"."${columnName}" has default ${schemaColumn.default} in database but contract specifies no default`,
    });
    columnChildren.push({
      status: 'fail',
      kind: 'default',
      name: 'default',
      contractPath: `${columnPath}.default`,
      code: 'extra_default',
      message: `Extra default: ${schemaColumn.default}`,
      expected: undefined,
      actual: schemaColumn.default,
      children: [],
    });
    columnStatus = 'fail';
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
  storageTypes: Readonly<Record<string, StorageTypeInstance | PostgresEnumStorageEntry>>,
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

  // If no typeParams or codecId, return the base native type
  if (!typeParams || !codecId) {
    return nativeType;
  }

  // Try to use the codec's expandNativeType hook if available
  const hooks = codecHooks.get(codecId);
  if (hooks?.expandNativeType) {
    return hooks.expandNativeType({ nativeType, codecId, typeParams });
  }

  // Fallback: return base native type if no hook is available
  return nativeType;
}

function resolveContractColumnTypeMetadata(
  contractColumn: StorageColumn,
  storageTypes: Readonly<Record<string, StorageTypeInstance | PostgresEnumStorageEntry>>,
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

  if (isPostgresEnumStorageEntry(referencedType)) {
    return {
      codecId: referencedType.codecId,
      nativeType: referencedType.nativeType,
      typeParams: { values: referencedType.values } as Record<string, unknown>,
    };
  }
  if (isStorageTypeInstance(referencedType)) {
    return {
      codecId: referencedType.codecId,
      nativeType: referencedType.nativeType,
      typeParams: referencedType.typeParams,
    };
  }
  throw new Error(
    `Storage type "${contractColumn.typeRef}" has an unknown polymorphic kind; expected codec-instance or postgres-enum.`,
  );
}

/**
 * Describes a column default for display purposes.
 */
function describeColumnDefault(columnDefault: ColumnDefault): string {
  switch (columnDefault.kind) {
    case 'autoincrement':
      return 'autoincrement';
    case 'expression':
      return columnDefault.expression;
  }
}

/**
 * Structural narrowing for SQL-family codecs that carry `renderSqlLiteral`.
 * Mirrors the same shape used by the PSL parser (see
 * `psl-column-resolution.ts` § `CodecWithRenderSqlLiteral`): the
 * framework-level {@link CodecLookup} returns the narrower framework
 * `Codec`, so the call site narrows structurally rather than depending on
 * the SQL-family `Codec` interface from `sql-relational-core/ast`.
 */
interface CodecWithRenderSqlLiteral {
  readonly id: string;
  decodeJson(json: JsonValue): unknown;
  renderSqlLiteral(value: unknown): string;
}

function hasRenderSqlLiteral(
  codec: { decodeJson(json: JsonValue): unknown } | undefined,
): codec is CodecWithRenderSqlLiteral {
  return (
    codec !== undefined &&
    'renderSqlLiteral' in codec &&
    typeof (codec as { renderSqlLiteral?: unknown }).renderSqlLiteral === 'function'
  );
}

/**
 * Case-insensitive, whitespace-tolerant SQL expression comparison.
 *
 * Two codec round-tripped forms may differ only in casing or whitespace
 * (e.g. `TRUE` vs `true`, `'foo'::text` vs `'foo' :: text`) — the collapse
 * pinned here is conservative enough that semantically equal forms compare
 * equal while syntactically distinct forms (`'foo'` vs `'bar'`) do not.
 */
function expressionsEqual(a: string, b: string): boolean {
  const normalise = (expr: string) => expr.toLowerCase().replace(/\s+/g, '');
  return normalise(a) === normalise(b);
}

/**
 * Structural equality for JSON-shaped typed values (objects + arrays +
 * primitives). Used by the codec round-trip path so JSONB-style
 * key-order-independent comparison succeeds when both sides decode to
 * the same semantic value but the codec's `renderSqlLiteral`
 * (e.g. `JSON.stringify`) is order-sensitive.
 *
 * Other codec output types fall back to JS `===` (handled in the
 * primitive arm). `Date` instances compare by `.getTime()` so two Date
 * values built from the same instant compare equal even when constructed
 * via different string forms.
 */
function jsonValuesStructurallyEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  if (a instanceof Date && b instanceof Date) {
    return a.getTime() === b.getTime();
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      if (!jsonValuesStructurallyEqual(a[i], b[i])) return false;
    }
    return true;
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const aRecord = a as Record<string, unknown>;
    const bRecord = b as Record<string, unknown>;
    const aKeys = Object.keys(aRecord);
    const bKeys = Object.keys(bRecord);
    if (aKeys.length !== bKeys.length) return false;
    for (const key of aKeys) {
      if (!Object.hasOwn(bRecord, key)) return false;
      if (!jsonValuesStructurallyEqual(aRecord[key], bRecord[key])) return false;
    }
    return true;
  }
  return false;
}

/**
 * Compares a contract ColumnDefault against a schema raw default string for semantic equality.
 *
 * Three layers of comparison, in order:
 *
 * 1. **Codec round-trip.** When the column's codec is available in the
 *    lookup AND the per-target {@link SchemaDefaultValueParser} extracts a
 *    {@link JsonValue} out of the raw schema default, dispatch through
 *    `codec.decodeJson(value)` → `codec.renderSqlLiteral(typed)` to produce
 *    a contract-canonical expression. Compare that canonical form against
 *    `contract.default.expression`. The codec is the canonical comparison
 *    oracle — both sides go through `renderSqlLiteral` (the contract side
 *    at emit time, the schema side here at verify time).
 *
 * 2. **Legacy normalizer.** When the codec round-trip is unavailable (no
 *    codec, no parser, parser returned undefined, decodeJson threw),
 *    fall back to the per-target {@link DefaultNormalizer} that converts
 *    the raw schema default into a normalised {@link ColumnDefault} and
 *    compares against the contract default with case-insensitive
 *    whitespace-tolerant expression matching.
 *
 * 3. **Direct string compare.** When no normalizer is provided, compare
 *    the contract expression directly against the raw schema string (with
 *    a lenient bare-vs-quoted check for legacy fixtures).
 *
 * `kind: 'autoincrement'` always short-circuits to kind-equality on
 * whichever side a normalised value is available (codec round-trip is
 * skipped — codec is NOT invoked for autoincrement, matching the producer
 * convention in `build-contract.ts` and `psl-column-resolution.ts`).
 *
 * @param contractDefault - The expected default from the contract.
 * @param schemaDefault - The raw default expression from the database.
 * @param normalizer - Optional target-specific normalizer to convert raw defaults.
 * @param nativeType - The column's native type, passed to normalizer / parser for context.
 * @param codec - Optional codec for the column (resolved via `codecLookup.get(codecId)`).
 * @param valueParser - Optional per-target parser that extracts a JsonValue from the raw default.
 */
function columnDefaultsEqual(
  contractDefault: ColumnDefault,
  schemaDefault: string,
  normalizer?: DefaultNormalizer,
  nativeType?: string,
  codec?: { decodeJson(json: JsonValue): unknown } | undefined,
  valueParser?: SchemaDefaultValueParser,
): boolean {
  // 1. Codec round-trip.
  //
  // Skipped for autoincrement contract defaults — codec is never invoked on
  // the autoincrement arm (producer side: `build-contract.ts`,
  // `psl-column-resolution.ts`). The autoincrement match flows through the
  // normalizer path (which detects `nextval(...)` and produces `{ kind:
  // 'autoincrement' }`).
  if (contractDefault.kind === 'expression' && hasRenderSqlLiteral(codec) && valueParser) {
    const schemaParsedValue = valueParser(schemaDefault, nativeType ?? '');
    if (schemaParsedValue !== undefined) {
      try {
        const schemaTyped = codec.decodeJson(schemaParsedValue);
        const schemaCanonical = codec.renderSqlLiteral(schemaTyped);
        if (expressionsEqual(contractDefault.expression, schemaCanonical)) {
          return true;
        }
        // Round-trip the contract-side expression through the same parser
        // + codec so cases where the contract carries a literal whose
        // codec re-render does NOT reproduce the contract expression
        // verbatim (e.g. JSONB key-order: `'{"a":1,"b":2}'::jsonb` vs the
        // codec's `JSON.stringify` output) still compare equal when both
        // sides decode to the same typed value.
        const contractParsedValue = valueParser(contractDefault.expression, nativeType ?? '');
        if (contractParsedValue !== undefined) {
          try {
            const contractTyped = codec.decodeJson(contractParsedValue);
            const contractCanonical = codec.renderSqlLiteral(contractTyped);
            if (expressionsEqual(contractCanonical, schemaCanonical)) {
              return true;
            }
            // Structural comparison on the typed values handles cases
            // where the codec's `renderSqlLiteral` is order-sensitive on a
            // structure that should be order-independent (the canonical
            // example is JSONB: `JSON.stringify({a:1,b:2})` ≠
            // `JSON.stringify({b:2,a:1})` even though the JSONB values are
            // semantically equal). The structural compare is JSON-value
            // shaped: the typed value reduces to a {@link JsonValue}-like
            // tree when both sides went through `decodeJson` whose return
            // is `JsonValue` or a JS-native value `JSON.stringify`-stable.
            if (jsonValuesStructurallyEqual(contractTyped, schemaTyped)) {
              return true;
            }
          } catch {
            // contract side failed to round-trip; fall through.
          }
        }
        // Both round-trips done; canonicals don't match — fall through to
        // the normalizer path so the legacy compare can still rescue
        // cases like `'draft'::text` vs `draft` that the codec's
        // per-dialect cast wrapping would otherwise reject.
      } catch {
        // decodeJson threw — likely because the parsed value's shape
        // doesn't satisfy the codec's strict input contract. Fall through
        // to the normalizer path.
      }
    }
  }

  // 2/3. Legacy normalizer + direct string compare.
  if (!normalizer) {
    if (contractDefault.kind === 'autoincrement') {
      return false;
    }
    const expr = contractDefault.expression;
    return expr === schemaDefault || `'${expr}'` === schemaDefault;
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
  if (contractDefault.kind === 'autoincrement') {
    return true;
  }
  if (contractDefault.kind === 'expression' && normalizedSchema.kind === 'expression') {
    return expressionsEqual(contractDefault.expression, normalizedSchema.expression);
  }
  return false;
}
