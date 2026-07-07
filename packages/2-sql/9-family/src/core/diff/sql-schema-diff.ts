/**
 * The relational schema-issue diff: compares a SqlSchemaIR against a
 * Contract and returns coordinate-based `SchemaIssue`s — no database
 * connection, no verification tree. This is the migration planner's diff
 * input (the target `diffDatabaseSchema` hooks compose it); the verify
 * verdict runs on the generic node differ instead
 * (`schema-diff-verify.ts`). The planner switches to node-typed issues
 * with `plan(start, end)`, which retires this module.
 */

import type { ColumnDefault, Contract, ControlPolicy } from '@prisma-next/contract/types';
import { effectiveControlPolicy } from '@prisma-next/contract/types';
import type { TargetBoundComponentDescriptor } from '@prisma-next/framework-components/components';
import type { SchemaIssue } from '@prisma-next/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import type {
  ForeignKey,
  Index,
  PrimaryKey,
  SqlStorage,
  StorageColumn,
  StorageTypeInstance,
  UniqueConstraint,
} from '@prisma-next/sql-contract/types';
import { isStorageTypeInstance, StorageTable } from '@prisma-next/sql-contract/types';
import type {
  SqlCheckConstraintIR,
  SqlForeignKeyIR,
  SqlIndexIR,
  SqlSchemaIRNode,
  SqlUniqueIR,
} from '@prisma-next/sql-schema-ir/types';
import { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import { canonicalStringify } from '@prisma-next/utils/canonical-stringify';
import { blindCast } from '@prisma-next/utils/casts';
import { ifDefined } from '@prisma-next/utils/defined';
import { extractCodecControlHooks } from '../assembly';
import { resolveValueSetValues } from '../migrations/contract-to-schema-ir';
import type { CodecControlHooks } from '../migrations/types';
import { verifierDisposition } from './verifier-disposition';

/**
 * Returns the per-schema namespace nodes of an introspected schema node.
 * Structure-agnostic — imports no target node class. A root exposing a
 * `namespaces` record (Postgres) yields its namespace nodes (never merged, so
 * same-named tables in different schemas cannot collide); a flat schema
 * (SQLite) is its own single namespace and yields itself. Handles
 * spread-flattened input (own-enumerable fields survive).
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
 * Options for the relational schema-issue diff.
 */
export interface CollectSqlSchemaIssuesOptions {
  /** The validated SQL contract to diff against */
  readonly contract: Contract<SqlStorage>;
  /** The schema IR from introspection (or another source) */
  readonly schema: SqlSchemaIR;
  /** Whether to run in strict mode (detects extra tables/columns) */
  readonly strict: boolean;
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
   * Used by the per-namespace pairing, which pairs each contract namespace to
   * its own actual node. Absent ⇒ all contract namespaces are checked against
   * the single (flat) `schema` — the single-schema / SQLite path.
   */
  readonly restrictToNamespaceIds?: ReadonlySet<string>;
}

/**
 * Diffs a SqlSchemaIR against a Contract and returns the coordinate-based
 * issue list. Pure — no database I/O. Control-policy suppression is applied
 * at emission (a `suppress` disposition drops the issue); `warn` and `fail`
 * dispositions both emit, exactly as the planner input always carried.
 */
export function collectSqlSchemaIssues(
  options: CollectSqlSchemaIssuesOptions,
): readonly SchemaIssue[] {
  const { contract, schema, strict, normalizeDefault, normalizeNativeType } = options;

  const codecHooks = extractCodecControlHooks(options.frameworkComponents);
  const storageTypes: Readonly<Record<string, StorageTypeInstance>> = contract.storage.types ?? {};
  const issues = collectTableIssues({
    contract,
    schema,
    strict,
    codecHooks,
    storageTypes,
    ...ifDefined('normalizeDefault', normalizeDefault),
    ...ifDefined('normalizeNativeType', normalizeNativeType),
    ...ifDefined('restrictToNamespaceIds', options.restrictToNamespaceIds),
  });

  validateFrameworkComponentsForExtensions(contract, options.frameworkComponents);

  // Top-level `storage.types`: codec-typed entries via codec hooks. Each
  // issue's disposition (fail / warn / suppress) resolves from the contract
  // default control policy so an `external`/`observed` enum does not
  // hard-fail on value drift.
  const typeControlPolicy = effectiveControlPolicy(undefined, contract.defaultControlPolicy);
  for (const [typeName, typeInstance] of Object.entries(contract.storage.types ?? {})) {
    if (!isStorageTypeInstance(typeInstance)) continue;
    const hook = codecHooks.get(typeInstance.codecId);
    const typeIssues = hook?.verifyType ? hook.verifyType({ typeName, typeInstance, schema }) : [];
    for (const issue of typeIssues) {
      const disposition = verifierDisposition(typeControlPolicy, issue.kind);
      if (disposition === 'suppress') continue;
      issues.push(issue);
    }
  }

  return issues;
}

function collectTableIssues(options: {
  contract: Contract<SqlStorage>;
  schema: SqlSchemaIR;
  strict: boolean;
  codecHooks: Map<string, CodecControlHooks>;
  storageTypes: Readonly<Record<string, StorageTypeInstance>>;
  normalizeDefault?: DefaultNormalizer;
  normalizeNativeType?: NativeTypeNormalizer;
  restrictToNamespaceIds?: ReadonlySet<string>;
}): SchemaIssue[] {
  const {
    contract,
    schema,
    strict,
    codecHooks,
    storageTypes,
    normalizeDefault,
    normalizeNativeType,
    restrictToNamespaceIds,
  } = options;
  const contractDefaultControl = contract.defaultControlPolicy;
  const issues: SchemaIssue[] = [];
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

      if (!schemaTable) {
        emitIssueUnderControlPolicy(
          tableControlPolicy,
          {
            kind: 'missing_table',
            reason: 'not-found',
            table: tableName,
            namespaceId,
            message: `Table "${tableName}" is missing from database`,
          },
          issues,
        );
        continue;
      }

      collectTableChildIssues({
        contractTable,
        schemaTable,
        tableName,
        namespaceId,
        tableControlPolicy,
        issues,
        strict,
        codecHooks,
        storageTypes,
        contractStorage: contract.storage,
        ...ifDefined('normalizeDefault', normalizeDefault),
        ...ifDefined('normalizeNativeType', normalizeNativeType),
      });
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
        emitIssueUnderControlPolicy(
          extraTableControlPolicy,
          {
            kind: 'extra_table',
            reason: 'not-expected',
            table: tableName,
            message: `Extra table "${tableName}" found in database (not in contract)`,
          },
          issues,
        );
      }
    }
  }

  return issues;
}

function collectTableChildIssues(options: {
  contractTable: StorageTable;
  schemaTable: SqlSchemaIR['tables'][string];
  tableName: string;
  namespaceId: string;
  tableControlPolicy: ControlPolicy;
  issues: SchemaIssue[];
  strict: boolean;
  codecHooks: Map<string, CodecControlHooks>;
  storageTypes: Readonly<Record<string, StorageTypeInstance>>;
  normalizeDefault?: DefaultNormalizer;
  normalizeNativeType?: NativeTypeNormalizer;
  contractStorage: SqlStorage;
}): void {
  const {
    contractTable,
    schemaTable,
    tableName,
    namespaceId,
    tableControlPolicy,
    issues,
    strict,
    codecHooks,
    storageTypes,
    normalizeDefault,
    normalizeNativeType,
    contractStorage,
  } = options;

  for (const [columnName, contractColumn] of Object.entries(contractTable.columns)) {
    const schemaColumn = schemaTable.columns[columnName];

    if (!schemaColumn) {
      emitIssueUnderControlPolicy(
        tableControlPolicy,
        {
          kind: 'missing_column',
          reason: 'not-found',
          table: tableName,
          namespaceId,
          column: columnName,
          message: `Column "${tableName}"."${columnName}" is missing from database`,
        },
        issues,
      );
      continue;
    }

    collectColumnIssues({
      tableName,
      namespaceId,
      columnName,
      contractColumn,
      schemaColumn,
      tableControlPolicy,
      issues,
      strict,
      codecHooks,
      storageTypes,
      ...ifDefined('normalizeDefault', normalizeDefault),
      ...ifDefined('normalizeNativeType', normalizeNativeType),
    });
  }

  if (strict) {
    for (const columnName of Object.keys(schemaTable.columns)) {
      if (!contractTable.columns[columnName]) {
        emitIssueUnderControlPolicy(
          tableControlPolicy,
          {
            kind: 'extra_column',
            reason: 'not-expected',
            table: tableName,
            namespaceId,
            column: columnName,
            message: `Extra column "${tableName}"."${columnName}" found in database (not in contract)`,
          },
          issues,
        );
      }
    }
  }

  if (contractTable.primaryKey) {
    collectPrimaryKeyIssues(
      contractTable.primaryKey,
      schemaTable.primaryKey,
      tableName,
      namespaceId,
      tableControlPolicy,
      issues,
    );
  } else if (schemaTable.primaryKey && strict) {
    emitIssueUnderControlPolicy(
      tableControlPolicy,
      {
        kind: 'extra_primary_key',
        reason: 'not-expected',
        table: tableName,
        namespaceId,
        message: 'Extra primary key found in database (not in contract)',
      },
      issues,
    );
  }

  // Diff FK constraints only for FKs with constraint: true.
  // Always run when strict mode is on so extra-FK detection runs even if
  // the contract has no FKs for this table.
  const constraintFks = contractTable.foreignKeys.filter((fk) => fk.constraint === true);
  if (constraintFks.length > 0 || strict) {
    collectForeignKeyIssues(
      constraintFks,
      schemaTable.foreignKeys,
      tableName,
      namespaceId,
      tableControlPolicy,
      issues,
      strict,
    );
  }

  collectUniqueConstraintIssues(
    contractTable.uniques,
    schemaTable.uniques,
    schemaTable.indexes,
    tableName,
    namespaceId,
    tableControlPolicy,
    issues,
    strict,
  );

  // Combine user-declared indexes with FK-backing indexes (from FKs with index: true)
  // so FK-backing indexes count as expected, not "extra".
  // Deduplicate: skip FK-backing indexes already covered by a user-declared index.
  const fkBackingIndexes = contractTable.foreignKeys
    .filter(
      (fk) =>
        fk.index === true &&
        !contractTable.indexes.some((idx) => arraysEqual(idx.columns, fk.source.columns)),
    )
    .map((fk) => ({ columns: fk.source.columns }));
  const allExpectedIndexes = [...contractTable.indexes, ...fkBackingIndexes];

  collectIndexIssues(
    allExpectedIndexes,
    schemaTable.indexes,
    schemaTable.uniques,
    tableName,
    namespaceId,
    tableControlPolicy,
    issues,
    strict,
  );

  // Diff check constraints when the contract declares checks for this table OR
  // when strict mode is on (so extra live checks on zero-check tables are detected).
  // schemaTable.checks carries the introspected live checks (parsed value sets).
  const contractCheckIRs = (contractTable.checks ?? []).map((c) => ({
    name: c.name,
    column: c.column,
    permittedValues: resolveValueSetValues(c.valueSet, contractStorage, `check "${c.name}"`),
  }));
  if (strict || contractCheckIRs.length > 0) {
    collectCheckConstraintIssues(
      contractCheckIRs,
      schemaTable.checks ?? [],
      tableName,
      namespaceId,
      tableControlPolicy,
      issues,
      strict,
    );
  }
}

function collectColumnIssues(options: {
  tableName: string;
  namespaceId: string;
  columnName: string;
  contractColumn: StorageTable['columns'][string];
  schemaColumn: SqlSchemaIR['tables'][string]['columns'][string];
  tableControlPolicy: ControlPolicy;
  issues: SchemaIssue[];
  strict: boolean;
  codecHooks: Map<string, CodecControlHooks>;
  storageTypes: Readonly<Record<string, StorageTypeInstance>>;
  normalizeDefault?: DefaultNormalizer;
  normalizeNativeType?: NativeTypeNormalizer;
}): void {
  const {
    tableName,
    namespaceId,
    columnName,
    contractColumn,
    schemaColumn,
    tableControlPolicy,
    issues,
    strict,
    codecHooks,
    storageTypes,
    normalizeDefault,
    normalizeNativeType,
  } = options;

  const contractNativeType = renderExpectedNativeType(contractColumn, storageTypes, codecHooks, {
    tableName,
    columnName,
  });
  const schemaBaseNativeType =
    normalizeNativeType?.(schemaColumn.nativeType) ?? schemaColumn.nativeType;
  const schemaNativeType = schemaColumn.many ? `${schemaBaseNativeType}[]` : schemaBaseNativeType;

  if (contractNativeType !== schemaNativeType) {
    emitIssueUnderControlPolicy(
      tableControlPolicy,
      {
        kind: 'type_mismatch',
        reason: 'not-equal',
        table: tableName,
        namespaceId,
        column: columnName,
        expected: contractNativeType,
        actual: schemaNativeType,
        message: `Column "${tableName}"."${columnName}" has type mismatch: expected "${contractNativeType}", got "${schemaNativeType}"`,
      },
      issues,
    );
  }

  if (contractColumn.nullable !== schemaColumn.nullable) {
    emitIssueUnderControlPolicy(
      tableControlPolicy,
      {
        kind: 'nullability_mismatch',
        reason: 'not-equal',
        table: tableName,
        namespaceId,
        column: columnName,
        expected: String(contractColumn.nullable),
        actual: String(schemaColumn.nullable),
        message: `Column "${tableName}"."${columnName}" has nullability mismatch: expected ${contractColumn.nullable ? 'nullable' : 'not null'}, got ${schemaColumn.nullable ? 'nullable' : 'not null'}`,
      },
      issues,
    );
  }

  if (contractColumn.default) {
    if (!schemaColumn.default) {
      const defaultDescription = describeColumnDefault(contractColumn.default);
      emitIssueUnderControlPolicy(
        tableControlPolicy,
        {
          kind: 'default_missing',
          reason: 'not-found',
          table: tableName,
          namespaceId,
          column: columnName,
          expected: defaultDescription,
          message: `Column "${tableName}"."${columnName}" should have default ${defaultDescription} but database has no default`,
        },
        issues,
      );
    } else if (
      !columnDefaultsEqual(
        contractColumn.default,
        schemaColumn.default,
        normalizeDefault,
        schemaNativeType,
      )
    ) {
      const expectedDescription = describeColumnDefault(contractColumn.default);
      emitIssueUnderControlPolicy(
        tableControlPolicy,
        {
          kind: 'default_mismatch',
          reason: 'not-equal',
          table: tableName,
          namespaceId,
          column: columnName,
          expected: expectedDescription,
          actual: schemaColumn.default,
          message: `Column "${tableName}"."${columnName}" has default mismatch: expected ${expectedDescription}, got ${schemaColumn.default}`,
        },
        issues,
      );
    }
  } else if (strict && schemaColumn.default) {
    emitIssueUnderControlPolicy(
      tableControlPolicy,
      {
        kind: 'extra_default',
        reason: 'not-expected',
        table: tableName,
        namespaceId,
        column: columnName,
        actual: schemaColumn.default,
        message: `Column "${tableName}"."${columnName}" has default ${schemaColumn.default} in database but contract specifies no default`,
      },
      issues,
    );
  }
}

/**
 * Grades `issue` under `controlPolicy` and, unless suppressed, pushes it.
 */
function emitIssueUnderControlPolicy(
  controlPolicy: ControlPolicy,
  issue: SchemaIssue,
  issues: SchemaIssue[],
): void {
  const disposition = verifierDisposition(controlPolicy, issue.kind);
  if (disposition === 'suppress') return;
  issues.push(issue);
}

// ============================================================================
// Per-entity issue collection (ported from the legacy verify helpers;
// identical issue emission, no tree nodes)
// ============================================================================

function indexOptionsLooselyEqual(
  a: Record<string, unknown> | undefined,
  b: Record<string, unknown> | undefined,
): boolean {
  const aKeys = a ? Object.keys(a).sort() : [];
  const bKeys = b ? Object.keys(b).sort() : [];
  if (aKeys.length !== bKeys.length) return false;
  for (let i = 0; i < aKeys.length; i += 1) {
    if (aKeys[i] !== bKeys[i]) return false;
  }
  if (aKeys.length === 0) return true;
  for (const key of aKeys) {
    // Postgres introspection returns reloptions values as raw strings (e.g.
    // `'70'`, `'false'`), while contract option leaves are typed (number,
    // boolean, string). Compare via String() so a contract `fillfactor: 70`
    // matches an introspected `fillfactor: '70'` without a spurious mismatch.
    if (
      String((a as Record<string, unknown>)[key]) !== String((b as Record<string, unknown>)[key])
    ) {
      return false;
    }
  }
  return true;
}

function indexExtrasMatch(
  contractIndex: { readonly type?: string; readonly options?: Record<string, unknown> },
  schemaIndex: { readonly type?: string; readonly options?: Record<string, unknown> },
): boolean {
  if ((contractIndex.type ?? null) !== (schemaIndex.type ?? null)) return false;
  return indexOptionsLooselyEqual(contractIndex.options, schemaIndex.options);
}

/**
 * Compares two arrays of strings for equality (order-sensitive).
 */
export function arraysEqual(a: readonly string[], b: readonly string[]): boolean {
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
 * Checks if a unique constraint requirement is satisfied by the given columns:
 * a unique constraint with the same columns, or a unique index with the same
 * columns (semantic satisfaction). Used by the planners to keep the
 * "stronger satisfies weaker" behavior consistent across the control plane.
 */
export function isUniqueConstraintSatisfied(
  uniques: readonly SqlUniqueIR[],
  indexes: readonly SqlIndexIR[],
  columns: readonly string[],
): boolean {
  const hasConstraint = uniques.some((unique) => arraysEqual(unique.columns, columns));
  if (hasConstraint) {
    return true;
  }
  return indexes.some((index) => index.unique && arraysEqual(index.columns, columns));
}

/**
 * Checks if an index requirement is satisfied by the given columns: any index
 * (unique or non-unique) with the same columns, or a unique constraint with
 * the same columns (stronger satisfies weaker).
 */
export function isIndexSatisfied(
  indexes: readonly SqlIndexIR[],
  uniques: readonly SqlUniqueIR[],
  columns: readonly string[],
): boolean {
  const hasMatchingIndex = indexes.some((index) => arraysEqual(index.columns, columns));
  if (hasMatchingIndex) {
    return true;
  }
  return uniques.some((unique) => arraysEqual(unique.columns, columns));
}

function collectPrimaryKeyIssues(
  contractPK: PrimaryKey,
  schemaPK: PrimaryKey | undefined,
  tableName: string,
  namespaceId: string,
  tableControlPolicy: ControlPolicy,
  issues: SchemaIssue[],
): void {
  if (!schemaPK) {
    emitIssueUnderControlPolicy(
      tableControlPolicy,
      {
        kind: 'primary_key_mismatch',
        reason: 'not-equal',
        table: tableName,
        namespaceId,
        expected: contractPK.columns.join(', '),
        message: `Table "${tableName}" is missing primary key`,
      },
      issues,
    );
    return;
  }

  if (!arraysEqual(contractPK.columns, schemaPK.columns)) {
    emitIssueUnderControlPolicy(
      tableControlPolicy,
      {
        kind: 'primary_key_mismatch',
        reason: 'not-equal',
        table: tableName,
        namespaceId,
        expected: contractPK.columns.join(', '),
        actual: schemaPK.columns.join(', '),
        message: `Table "${tableName}" has primary key mismatch: expected columns [${contractPK.columns.join(', ')}], got [${schemaPK.columns.join(', ')}]`,
      },
      issues,
    );
  }
}

function collectForeignKeyIssues(
  contractFKs: readonly ForeignKey[],
  schemaFKs: readonly SqlForeignKeyIR[],
  tableName: string,
  namespaceId: string,
  tableControlPolicy: ControlPolicy,
  issues: SchemaIssue[],
  strict: boolean,
): void {
  // Check each contract FK exists in schema
  for (const contractFK of contractFKs) {
    const matchingFK = schemaFKs.find((fk) => {
      // When the schema FK carries referencedSchema (populated by the Postgres
      // adapter for cross-schema FKs), compare the full (namespace, table) pair
      // against the contract FK's target coordinate. When referencedSchema is
      // absent (same-schema FKs, older introspection, or hand-crafted test
      // fixtures), fall back to table-name-only comparison so same-namespace
      // contracts continue to verify correctly.
      const tablesMatch =
        fk.referencedSchema !== undefined && contractFK.target.namespaceId !== UNBOUND_NAMESPACE_ID
          ? fk.referencedSchema === contractFK.target.namespaceId &&
            fk.referencedTable === contractFK.target.tableName
          : fk.referencedTable === contractFK.target.tableName;
      return (
        arraysEqual(fk.columns, contractFK.source.columns) &&
        tablesMatch &&
        arraysEqual(fk.referencedColumns, contractFK.target.columns)
      );
    });

    if (!matchingFK) {
      emitIssueUnderControlPolicy(
        tableControlPolicy,
        {
          kind: 'foreign_key_mismatch',
          reason: 'not-equal',
          table: tableName,
          namespaceId,
          expected: `${contractFK.source.columns.join(', ')} -> ${contractFK.target.tableName}(${contractFK.target.columns.join(', ')})`,
          message: `Table "${tableName}" is missing foreign key: ${contractFK.source.columns.join(', ')} -> ${contractFK.target.tableName}(${contractFK.target.columns.join(', ')})`,
        },
        issues,
      );
    } else {
      const actionMismatches = getReferentialActionMismatches(contractFK, matchingFK);
      if (actionMismatches.length > 0) {
        const combinedMessage = actionMismatches.map((m) => m.message).join('; ');
        emitIssueUnderControlPolicy(
          tableControlPolicy,
          {
            kind: 'foreign_key_mismatch',
            reason: 'not-equal',
            table: tableName,
            namespaceId,
            indexOrConstraint: matchingFK.name ?? `fk(${contractFK.source.columns.join(',')})`,
            expected: actionMismatches.map((m) => m.expected).join(', '),
            actual: actionMismatches.map((m) => m.actual).join(', '),
            message: `Table "${tableName}" foreign key ${contractFK.source.columns.join(', ')} -> ${contractFK.target.tableName}: ${combinedMessage}`,
          },
          issues,
        );
      }
    }
  }

  // Check for extra FKs in strict mode
  if (strict) {
    for (const schemaFK of schemaFKs) {
      const matchingFK = contractFKs.find((fk) => {
        const tablesMatch =
          schemaFK.referencedSchema !== undefined && fk.target.namespaceId !== UNBOUND_NAMESPACE_ID
            ? schemaFK.referencedSchema === fk.target.namespaceId &&
              schemaFK.referencedTable === fk.target.tableName
            : schemaFK.referencedTable === fk.target.tableName;
        return (
          arraysEqual(fk.source.columns, schemaFK.columns) &&
          tablesMatch &&
          arraysEqual(fk.target.columns, schemaFK.referencedColumns)
        );
      });

      if (!matchingFK) {
        emitIssueUnderControlPolicy(
          tableControlPolicy,
          {
            kind: 'extra_foreign_key',
            reason: 'not-expected',
            table: tableName,
            namespaceId,
            indexOrConstraint: schemaFK.name ?? `fk(${schemaFK.columns.join(',')})`,
            message: `Extra foreign key found in database (not in contract): ${schemaFK.columns.join(', ')} -> ${schemaFK.referencedTable}(${schemaFK.referencedColumns.join(', ')})`,
          },
          issues,
        );
      }
    }
  }
}

function collectUniqueConstraintIssues(
  contractUniques: readonly UniqueConstraint[],
  schemaUniques: readonly SqlUniqueIR[],
  schemaIndexes: readonly SqlIndexIR[],
  tableName: string,
  namespaceId: string,
  tableControlPolicy: ControlPolicy,
  issues: SchemaIssue[],
  strict: boolean,
): void {
  // Check each contract unique exists in schema; a unique constraint
  // requirement is satisfied by a same-column unique constraint OR a
  // same-column unique index (semantic satisfaction).
  for (const contractUnique of contractUniques) {
    if (!isUniqueConstraintSatisfied(schemaUniques, schemaIndexes, contractUnique.columns)) {
      emitIssueUnderControlPolicy(
        tableControlPolicy,
        {
          kind: 'unique_constraint_mismatch',
          reason: 'not-equal',
          table: tableName,
          namespaceId,
          expected: contractUnique.columns.join(', '),
          message: `Table "${tableName}" is missing unique constraint: ${contractUnique.columns.join(', ')}`,
        },
        issues,
      );
    }
  }

  if (strict) {
    for (const schemaUnique of schemaUniques) {
      const matchingUnique = contractUniques.find((u) =>
        arraysEqual(u.columns, schemaUnique.columns),
      );

      if (!matchingUnique) {
        emitIssueUnderControlPolicy(
          tableControlPolicy,
          {
            kind: 'extra_unique_constraint',
            reason: 'not-expected',
            table: tableName,
            namespaceId,
            indexOrConstraint: schemaUnique.name ?? `unique(${schemaUnique.columns.join(',')})`,
            message: `Extra unique constraint found in database (not in contract): ${schemaUnique.columns.join(', ')}`,
          },
          issues,
        );
      }
    }
  }
}

function collectIndexIssues(
  contractIndexes: readonly Pick<Index, 'columns' | 'type' | 'options'>[],
  schemaIndexes: readonly SqlIndexIR[],
  schemaUniques: readonly SqlUniqueIR[],
  tableName: string,
  namespaceId: string,
  tableControlPolicy: ControlPolicy,
  issues: SchemaIssue[],
  strict: boolean,
): void {
  // Check each contract index exists in schema. A unique index satisfies a
  // non-unique requirement (stronger satisfies weaker); a unique constraint
  // satisfies only a contract index with no type/options demands (constraints
  // carry no type/options of their own).
  for (const contractIndex of contractIndexes) {
    const matchingIndex = schemaIndexes.find(
      (idx) =>
        arraysEqual(idx.columns, contractIndex.columns) && indexExtrasMatch(contractIndex, idx),
    );

    const matchingUniqueConstraint =
      !matchingIndex &&
      contractIndex.type === undefined &&
      contractIndex.options === undefined &&
      schemaUniques.find((u) => arraysEqual(u.columns, contractIndex.columns));

    if (!matchingIndex && !matchingUniqueConstraint) {
      emitIssueUnderControlPolicy(
        tableControlPolicy,
        {
          kind: 'index_mismatch',
          reason: 'not-equal',
          table: tableName,
          namespaceId,
          expected: contractIndex.columns.join(', '),
          message: `Table "${tableName}" is missing index: ${contractIndex.columns.join(', ')}`,
        },
        issues,
      );
    }
  }

  if (strict) {
    for (const schemaIndex of schemaIndexes) {
      if (schemaIndex.unique) {
        continue;
      }

      const matchingIndex = contractIndexes.find(
        (idx) =>
          arraysEqual(idx.columns, schemaIndex.columns) && indexExtrasMatch(idx, schemaIndex),
      );

      if (!matchingIndex) {
        emitIssueUnderControlPolicy(
          tableControlPolicy,
          {
            kind: 'extra_index',
            reason: 'not-expected',
            table: tableName,
            namespaceId,
            indexOrConstraint: schemaIndex.name ?? `idx(${schemaIndex.columns.join(',')})`,
            message: `Extra index found in database (not in contract): ${schemaIndex.columns.join(', ')}`,
          },
          issues,
        );
      }
    }
  }
}

/**
 * Compares referential actions between a contract FK and a schema FK.
 * Only compares when the contract FK explicitly specifies onDelete or onUpdate.
 * Returns all mismatches (both onDelete and onUpdate) so both are reported at once.
 *
 * Note: 'noAction' in the contract is semantically equivalent to undefined in the
 * schema IR, because the introspection adapter omits 'NO ACTION' (the database default)
 * to keep the IR sparse. We normalize both sides before comparing.
 */
function getReferentialActionMismatches(
  contractFK: ForeignKey,
  schemaFK: SqlForeignKeyIR,
): ReadonlyArray<{ expected: string; actual: string; message: string }> {
  const mismatches: Array<{ expected: string; actual: string; message: string }> = [];

  const contractOnDelete = normalizeReferentialAction(contractFK.onDelete);
  const schemaOnDelete = normalizeReferentialAction(schemaFK.onDelete);
  if (contractOnDelete !== undefined && contractOnDelete !== schemaOnDelete) {
    mismatches.push({
      expected: `onDelete: ${contractFK.onDelete}`,
      actual: `onDelete: ${schemaFK.onDelete ?? 'noAction (default)'}`,
      message: `onDelete mismatch: expected ${contractFK.onDelete}, got ${schemaFK.onDelete ?? 'noAction (default)'}`,
    });
  }

  const contractOnUpdate = normalizeReferentialAction(contractFK.onUpdate);
  const schemaOnUpdate = normalizeReferentialAction(schemaFK.onUpdate);
  if (contractOnUpdate !== undefined && contractOnUpdate !== schemaOnUpdate) {
    mismatches.push({
      expected: `onUpdate: ${contractFK.onUpdate}`,
      actual: `onUpdate: ${schemaFK.onUpdate ?? 'noAction (default)'}`,
      message: `onUpdate mismatch: expected ${contractFK.onUpdate}, got ${schemaFK.onUpdate ?? 'noAction (default)'}`,
    });
  }

  return mismatches;
}

/**
 * Normalizes a referential action value for comparison.
 * 'noAction' is the database default and equivalent to undefined (omitted) in the sparse IR.
 */
function normalizeReferentialAction(action: string | undefined): string | undefined {
  return action === 'noAction' ? undefined : action;
}

/**
 * Compares two value arrays as unordered sets.
 * Returns true when both sides contain exactly the same values.
 */
function valueSetsEqual(a: readonly string[], b: readonly string[]): boolean {
  const aSet = new Set(a);
  const bSet = new Set(b);
  if (aSet.size !== bSet.size) return false;
  return [...aSet].every((v) => bSet.has(v));
}

/**
 * Diffs check constraints between contract-projected checks and introspected
 * live checks. Comparison is value-set-based, not SQL-string-based: Postgres
 * rewrites `col IN ('a','b')` as `col = ANY (ARRAY['a','b'])` in
 * `pg_get_constraintdef`, so comparing extracted value sets avoids false
 * mismatches from the rendering difference.
 *
 * Issues emitted: `check_missing` (expected, absent live), `check_mismatch`
 * (both present, values differ), `check_removed` (live, undeclared — strict
 * mode only).
 */
function collectCheckConstraintIssues(
  contractChecks: ReadonlyArray<{
    readonly name: string;
    readonly column: string;
    readonly permittedValues: readonly string[];
  }>,
  schemaChecks: ReadonlyArray<SqlCheckConstraintIR>,
  tableName: string,
  namespaceId: string,
  tableControlPolicy: ControlPolicy,
  issues: SchemaIssue[],
  strict: boolean,
): void {
  for (const contractCheck of contractChecks) {
    const liveCheck = schemaChecks.find((c) => c.name === contractCheck.name);

    if (!liveCheck) {
      emitIssueUnderControlPolicy(
        tableControlPolicy,
        {
          kind: 'check_missing',
          reason: 'not-found',
          table: tableName,
          namespaceId,
          indexOrConstraint: contractCheck.name,
          expected: contractCheck.permittedValues.join(', '),
          message: `Table "${tableName}" is missing check constraint "${contractCheck.name}" (column "${contractCheck.column}" IN (${contractCheck.permittedValues.join(', ')}))`,
        },
        issues,
      );
    } else if (!valueSetsEqual(contractCheck.permittedValues, liveCheck.permittedValues)) {
      emitIssueUnderControlPolicy(
        tableControlPolicy,
        {
          kind: 'check_mismatch',
          reason: 'not-equal',
          table: tableName,
          namespaceId,
          indexOrConstraint: contractCheck.name,
          expected: contractCheck.permittedValues.join(', '),
          actual: liveCheck.permittedValues.join(', '),
          message: `Table "${tableName}" check constraint "${contractCheck.name}" has different permitted values: expected [${contractCheck.permittedValues.join(', ')}], got [${liveCheck.permittedValues.join(', ')}]`,
        },
        issues,
      );
    }
  }

  if (strict) {
    for (const liveCheck of schemaChecks) {
      const matchingContract = contractChecks.find((c) => c.name === liveCheck.name);
      if (!matchingContract) {
        emitIssueUnderControlPolicy(
          tableControlPolicy,
          {
            kind: 'check_removed',
            reason: 'not-equal',
            table: tableName,
            namespaceId,
            indexOrConstraint: liveCheck.name,
            actual: liveCheck.permittedValues.join(', '),
            message: `Table "${tableName}" has extra check constraint "${liveCheck.name}" in database (not in contract)`,
          },
          issues,
        );
      }
    }
  }
}

// ============================================================================
// Column type/default resolution
// ============================================================================

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

// ============================================================================
// Per-namespace pairing (multi-schema databases)
// ============================================================================

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
 * expected-tree projection (never for diffing, so global value-sets it may
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
 * The per-namespace-paired relational issue diff for multi-schema databases —
 * the migration planner's diff input.
 *
 * Each contract namespace is paired to the introspected namespace node holding
 * the same DDL schema, then {@link collectSqlSchemaIssues} checks that
 * namespace's tables against the matching actual node (a contract table under
 * `auth` is only ever looked up in the `auth` actual node, so a multi-schema
 * database never reports tables in other schemas as missing). The full
 * contract is passed every time — `restrictToNamespaceIds` scopes only which
 * tables are checked, so cross-namespace value-set / control-policy resolution
 * is unaffected.
 *
 * The DDL schema of each contract namespace is read from a single-namespace
 * expected projection (`buildExpectedSchema`). Empty contract namespaces diff
 * nothing and are skipped. Single-schema (one namespace) and SQLite's flat
 * schema are one pairing.
 */
export function collectSqlSchemaIssuesPerNamespace(options: {
  readonly contract: Contract<SqlStorage>;
  readonly actualSchema: SqlSchemaIRNode;
  readonly buildExpectedSchema: (contract: Contract<SqlStorage>) => SqlSchemaIRNode;
  readonly strict: boolean;
  readonly frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<'sql', string>>;
  readonly normalizeDefault?: DefaultNormalizer;
  readonly normalizeNativeType?: NativeTypeNormalizer;
}): readonly SchemaIssue[] {
  const baseOptions = {
    contract: options.contract,
    strict: options.strict,
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
  const emptyNamespace = new SqlSchemaIR({ tables: {} });

  const issues: SchemaIssue[] = [];
  let paired = false;
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

    paired = true;
    issues.push(
      ...collectSqlSchemaIssues({
        ...baseOptions,
        schema: actualNode,
        restrictToNamespaceIds: new Set([namespaceId]),
      }),
    );
  }

  if (!paired) {
    issues.push(...collectSqlSchemaIssues({ ...baseOptions, schema: emptyNamespace }));
  }
  return issues;
}
