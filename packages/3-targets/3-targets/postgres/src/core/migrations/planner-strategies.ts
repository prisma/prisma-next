/**
 * Migration strategies.
 *
 * Each strategy examines the issue list, consumes issues it handles, and
 * returns the `PostgresOpFactoryCall[]` to address them. The issue planner
 * runs each strategy in order and routes whatever's left through
 * `mapIssueToCall`.
 *
 * The full ordered list is exported as `postgresPlannerStrategies` and is
 * used unchanged by both `migration plan` and `db update` / `db init`. The
 * two journeys differ only in `policy.allowedOperationClasses`:
 *
 * - When `'data'` is in the policy, data-safe strategies (NOT NULL backfill,
 *   nullability tightening, unsafe type changes) emit
 *   `DataTransformCall` placeholders that the user fills in.
 * - When `'data'` is excluded, those strategies short-circuit so the
 *   downstream walk-schema strategies (codec-hook type ops and temp-default
 *   backfill) and `mapIssueToCall` defaults emit direct DDL instead.
 */

import type { Contract } from '@prisma-next/contract/types';
import type {
  CodecControlHooks,
  MigrationOperationPolicy,
  SqlMigrationPlanOperation,
} from '@prisma-next/family-sql/control';
import { resolveValueSetValues } from '@prisma-next/family-sql/control';
import type { TargetBoundComponentDescriptor } from '@prisma-next/framework-components/components';
import type { SchemaIssue } from '@prisma-next/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import {
  type SqlStorage,
  StorageTable,
  type StorageTypeInstance,
} from '@prisma-next/sql-contract/types';
import type { CodecRef, DdlColumn } from '@prisma-next/sql-relational-core/ast';
import { col } from '@prisma-next/sql-relational-core/contract-free';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import { blindCast } from '@prisma-next/utils/casts';
import { ifDefined } from '@prisma-next/utils/defined';
import type { JsonValue } from '@prisma-next/utils/json';
import { isPostgresSchema } from '../postgres-schema';
import {
  AddCheckConstraintCall,
  AddColumnCall,
  AlterColumnTypeCall,
  DataTransformCall,
  DropCheckConstraintCall,
  type PostgresOpFactoryCall,
  postgresDefaultToDdlColumnDefault,
  RawSqlCall,
  SetNotNullCall,
} from './op-factory-call';
import { buildAddColumnSql, buildColumnTypeSql } from './planner-ddl-builders';
import { resolveIdentityValue } from './planner-identity-values';
import {
  buildAddColumnOperationIdentity,
  buildAddNotNullColumnWithTemporaryDefaultOperation,
} from './planner-recipes';
import { buildSchemaLookupMap, hasForeignKey, hasUniqueConstraint } from './planner-schema-lookup';
import {
  buildExpectedFormatType,
  columnExistsCheck,
  columnNullabilityCheck,
  qualifyTableName,
  tableIsEmptyCheck,
} from './planner-sql-checks';
import { buildTargetDetails, type PostgresPlanTargetDetails } from './planner-target-details';
import { resolveColumnTypeMetadata } from './planner-type-resolution';

/**
 * Look up a storage table by its explicit namespace coordinate. Returns
 * `undefined` when the namespace has no table by that name (or no such
 * namespace exists). Callers that get `undefined` MUST treat it as an
 * explicit conflict — never silently fall back to a global default
 * schema or a name-only walk, because that footgun would resolve a
 * stale or duplicate table name to whichever namespace the iteration
 * order surfaced first (a real data-loss hazard in multi-namespace
 * contracts where two namespaces can carry the same table name).
 */
export function tableAt(
  storage: SqlStorage,
  namespaceId: string,
  tableName: string,
): StorageTable | undefined {
  const ns = storage.namespaces[namespaceId];
  if (ns === undefined) return undefined;
  return ns.entries.table?.[tableName];
}

/**
 * Default namespace coordinate for an issue that does not carry one
 * explicitly. Hand-crafted unit-test issues and `extra_table` issues
 * fall back to `__unbound__`, the only namespace any single-namespace
 * contract carries — verifier-emitted issues for legacy
 * single-namespace contracts already stamp this id explicitly. Typed
 * structurally so issue variants without a `namespaceId` slot
 * (e.g. `EnumValuesChangedIssue`) flow through to the same fallback.
 */
export function resolveNamespaceIdForIssue(issue: { readonly namespaceId?: string }): string {
  return issue.namespaceId ?? UNBOUND_NAMESPACE_ID;
}

/**
 * Resolve the DDL schema name for a namespace coordinate. Postgres-aware
 * namespaces dispatch to their polymorphic `ddlSchemaName` override —
 * named schemas return their own id; the unbound singleton returns
 * `UNBOUND_NAMESPACE_ID`. Legacy single-namespace contracts whose
 * `__unbound__` slot is the framework-default `SqlUnboundNamespace`
 * (rather than the Postgres-aware `PostgresUnboundSchema`) flow the
 * coordinate through unchanged so downstream `qualifyTableName`
 * resolves polymorphically.
 */
export function resolveDdlSchemaForNamespace(ctx: StrategyContext, namespaceId: string): string {
  const namespace = ctx.toContract.storage.namespaces[namespaceId];
  if (isPostgresSchema(namespace)) {
    return namespace.ddlSchemaName(ctx.toContract.storage);
  }
  return namespaceId;
}

// ============================================================================
// Strategy types
// ============================================================================

/**
 * Context passed to each migration strategy.
 *
 * Strategies read the source (`fromContract`), target (`toContract`), current
 * database state (`schema`), operation policy (`policy`), and component list
 * (`frameworkComponents`) to make planning decisions. `fromContract` is null
 * when no prior contract is available (e.g. `db update`, where the current
 * DB state is approximated via `schema`).
 */
export interface StrategyContext {
  readonly toContract: Contract<SqlStorage>;
  readonly fromContract: Contract<SqlStorage> | null;
  readonly schemaName: string;
  readonly codecHooks: ReadonlyMap<string, CodecControlHooks>;
  readonly storageTypes: Readonly<Record<string, StorageTypeInstance>>;
  readonly schema: SqlSchemaIR;
  readonly policy: MigrationOperationPolicy;
  readonly frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<'sql', string>>;
}

// ============================================================================
// Call strategies (for issue planner)
// ============================================================================

export type CallMigrationStrategy = (
  issues: readonly SchemaIssue[],
  context: StrategyContext,
) =>
  | {
      kind: 'match';
      issues: readonly SchemaIssue[];
      calls: readonly PostgresOpFactoryCall[];
      /**
       * `true` for strategies that emit cohesive sequential recipes whose
       * calls must stay contiguous and in the returned order — e.g.
       * `notNullBackfillCallStrategy` (addColumn → dataTransform → setNotNull).
       * Defaults to `false`, which lets `planIssues` hoist individual calls
       * into their DDL sequencing bucket.
       */
      recipe?: boolean;
    }
  | { kind: 'no_match' };

function buildColumnSpec(
  namespaceId: string,
  table: string,
  column: string,
  ctx: StrategyContext,
  overrides?: { nullable?: boolean },
): DdlColumn {
  const storageCol = tableAt(ctx.toContract.storage, namespaceId, table)?.columns[column];
  if (!storageCol)
    throw new Error(`Column "${table}"."${column}" not found in destination contract`);
  const mutableHooks = ctx.codecHooks as Map<string, CodecControlHooks>;
  const mutableTypes = ctx.storageTypes as Record<string, StorageTypeInstance>;
  const typeSql = buildColumnTypeSql(storageCol, mutableHooks, mutableTypes);
  const ddlDefault = postgresDefaultToDdlColumnDefault(storageCol.default);
  const resolved = resolveColumnTypeMetadata(storageCol, mutableTypes);
  const typeParams =
    resolved.typeParams === undefined
      ? undefined
      : blindCast<
          JsonValue,
          'resolved.typeParams is JsonValue-shaped storage metadata; the narrowed value lands in CodecRef.typeParams which is JsonValue'
        >(resolved.typeParams);
  const codecRef: CodecRef | undefined = resolved.codecId
    ? {
        codecId: resolved.codecId,
        ...ifDefined('typeParams', typeParams),
      }
    : undefined;
  const nullable = overrides?.nullable ?? storageCol.nullable;
  return col(column, typeSql, {
    ...(!nullable ? { notNull: true } : {}),
    ...ifDefined('default', ddlDefault),
    ...ifDefined('codecRef', codecRef),
  });
}

function buildAlterTypeOptions(
  namespaceId: string,
  table: string,
  column: string,
  ctx: StrategyContext,
  using?: string,
) {
  const col = tableAt(ctx.toContract.storage, namespaceId, table)?.columns[column];
  if (!col) throw new Error(`Column "${table}"."${column}" not found in destination contract`);
  const mutableHooks = ctx.codecHooks as Map<string, CodecControlHooks>;
  const mutableTypes = ctx.storageTypes as Record<string, StorageTypeInstance>;
  const qualifiedTargetType = buildColumnTypeSql(col, mutableHooks, mutableTypes, false);
  const formatTypeExpected = buildExpectedFormatType(col, mutableHooks, mutableTypes);
  return {
    qualifiedTargetType,
    formatTypeExpected,
    rawTargetTypeForLabel: qualifiedTargetType,
    ...(using !== undefined ? { using } : {}),
  };
}

export const notNullBackfillCallStrategy: CallMigrationStrategy = (issues, ctx) => {
  // `DataTransformCall` is operation class `'data'`. When the policy excludes
  // it (`db update` / `db init`), skip so `notNullAddColumnCallStrategy`
  // (temp-default backfill) or `mapIssueToCall` can take the issue.
  if (!ctx.policy.allowedOperationClasses.includes('data')) return { kind: 'no_match' };

  const matched: SchemaIssue[] = [];
  const calls: PostgresOpFactoryCall[] = [];

  for (const issue of issues) {
    if (issue.kind !== 'missing_column' || !issue.table || !issue.column) continue;

    const namespaceId = resolveNamespaceIdForIssue(issue);
    const column = tableAt(ctx.toContract.storage, namespaceId, issue.table)?.columns[issue.column];
    if (!column) continue;
    if (column.nullable === true || column.default !== undefined) continue;

    matched.push(issue);
    const spec = buildColumnSpec(namespaceId, issue.table, issue.column, ctx, { nullable: true });
    const schemaForTable = resolveDdlSchemaForNamespace(ctx, namespaceId);
    calls.push(
      new AddColumnCall(schemaForTable, issue.table, spec),
      new DataTransformCall(
        `backfill-${issue.table}-${issue.column}`,
        `backfill-${issue.table}-${issue.column}:check`,
        `backfill-${issue.table}-${issue.column}:run`,
      ),
      new SetNotNullCall(schemaForTable, issue.table, issue.column),
    );
  }

  if (matched.length === 0) return { kind: 'no_match' };
  return {
    kind: 'match',
    issues: issues.filter((i) => !matched.includes(i)),
    calls,
    recipe: true,
  };
};

const SAFE_WIDENINGS = new Set(['int2→int4', 'int2→int8', 'int4→int8', 'float4→float8']);

export const typeChangeCallStrategy: CallMigrationStrategy = (issues, ctx) => {
  // For unsafe widenings this strategy emits a `DataTransformCall` placeholder
  // (operation class `'data'`); when the policy excludes `'data'`
  // (`db update` / `db init`), skip those issues so `mapIssueToCall` can
  // emit a direct `ALTER COLUMN TYPE`. Safe widenings still flow through
  // here because the resulting `AlterColumnTypeCall` is `widening`-class.
  const dataAllowed = ctx.policy.allowedOperationClasses.includes('data');

  const matched: SchemaIssue[] = [];
  const calls: PostgresOpFactoryCall[] = [];

  for (const issue of issues) {
    if (issue.kind !== 'type_mismatch') continue;
    if (!issue.table || !issue.column) continue;
    const namespaceId = resolveNamespaceIdForIssue(issue);
    const fromColumn = ctx.fromContract
      ? tableAt(ctx.fromContract.storage, namespaceId, issue.table)?.columns[issue.column]
      : undefined;
    const toColumn = tableAt(ctx.toContract.storage, namespaceId, issue.table)?.columns[
      issue.column
    ];
    if (!fromColumn || !toColumn) continue;
    const fromType = fromColumn.nativeType;
    const toType = toColumn.nativeType;
    if (fromType === toType) continue;
    const isSafeWidening = SAFE_WIDENINGS.has(`${fromType}→${toType}`);
    if (!isSafeWidening && !dataAllowed) continue;
    matched.push(issue);
    const alterOpts = buildAlterTypeOptions(namespaceId, issue.table, issue.column, ctx);
    const schemaForTable = resolveDdlSchemaForNamespace(ctx, namespaceId);
    if (isSafeWidening) {
      calls.push(new AlterColumnTypeCall(schemaForTable, issue.table, issue.column, alterOpts));
    } else {
      calls.push(
        new DataTransformCall(
          `typechange-${issue.table}-${issue.column}`,
          `typechange-${issue.table}-${issue.column}:check`,
          `typechange-${issue.table}-${issue.column}:run`,
        ),
        new AlterColumnTypeCall(schemaForTable, issue.table, issue.column, alterOpts),
      );
    }
  }
  if (matched.length === 0) return { kind: 'no_match' };
  return {
    kind: 'match',
    issues: issues.filter((i) => !matched.includes(i)),
    calls,
    recipe: true,
  };
};

export const nullableTighteningCallStrategy: CallMigrationStrategy = (issues, ctx) => {
  // `DataTransformCall` is operation class `'data'`. When the policy excludes
  // it (`db update` / `db init`), skip so `mapIssueToCall` emits a direct
  // `SET NOT NULL` instead.
  if (!ctx.policy.allowedOperationClasses.includes('data')) return { kind: 'no_match' };

  const matched: SchemaIssue[] = [];
  const calls: PostgresOpFactoryCall[] = [];

  for (const issue of issues) {
    if (issue.kind !== 'nullability_mismatch' || !issue.table || !issue.column) continue;

    const namespaceId = resolveNamespaceIdForIssue(issue);
    const column = tableAt(ctx.toContract.storage, namespaceId, issue.table)?.columns[issue.column];
    if (!column) continue;
    if (column.nullable === true) continue;

    matched.push(issue);
    const schemaForTable = resolveDdlSchemaForNamespace(ctx, namespaceId);
    calls.push(
      new DataTransformCall(
        `handle-nulls-${issue.table}-${issue.column}`,
        `handle-nulls-${issue.table}-${issue.column}:check`,
        `handle-nulls-${issue.table}-${issue.column}:run`,
      ),
      new SetNotNullCall(schemaForTable, issue.table, issue.column),
    );
  }

  if (matched.length === 0) return { kind: 'no_match' };
  return {
    kind: 'match',
    issues: issues.filter((i) => !matched.includes(i)),
    calls,
    recipe: true,
  };
};

/**
 * Collects every check constraint from a table in the contract storage.
 * Returns an empty array when the table has no checks or the table is absent.
 */
function collectContractChecks(
  storage: SqlStorage,
  namespaceId: string,
  tableName: string,
): ReadonlyArray<{ name: string; column: string; permittedValues: readonly string[] }> {
  const ns = storage.namespaces[namespaceId];
  const tableRaw = ns !== undefined ? ns.entries.table?.[tableName] : undefined;
  if (!(tableRaw instanceof StorageTable)) return [];
  const checks = tableRaw.checks;
  if (!checks || checks.length === 0) return [];
  return checks.map((c) => ({
    name: c.name,
    column: c.column,
    permittedValues: resolveValueSetValues(
      c.valueSet,
      storage,
      `check "${c.name}" on "${tableName}"`,
    ),
  }));
}

/**
 * Compares two value arrays as unordered sets.
 */
function checkValueSetsEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const bSet = new Set(b);
  return a.every((v) => bSet.has(v));
}

/**
 * Plans check-constraint migrations for `enumType`-authored columns.
 *
 * Walks every namespace's tables in the target contract. For each table that
 * carries `checks`, diffs the contract-expected checks against the live
 * schema's checks:
 *
 * - Check in contract, absent from live DB → `AddCheckConstraintCall`.
 * - Check in live DB, absent from contract → `DropCheckConstraintCall`.
 * - Check on both sides but value sets differ → `DropCheckConstraintCall`
 *   then `AddCheckConstraintCall` (drop + recreate; a check predicate cannot
 *   be altered in place).
 *
 * Consumes `check_missing`, `check_removed`, and `check_mismatch` issues.
 */
export const checkConstraintPlanCallStrategy: CallMigrationStrategy = (issues, ctx) => {
  const calls: PostgresOpFactoryCall[] = [];
  const handledIssueKeys = new Set<string>();

  for (const [namespaceId, ns] of Object.entries(ctx.toContract.storage.namespaces)) {
    for (const tableName of Object.keys(ns.entries.table ?? {})) {
      const contractChecks = collectContractChecks(ctx.toContract.storage, namespaceId, tableName);
      if (contractChecks.length === 0) continue;

      const schemaTable = ctx.schema.tables[tableName];
      const liveChecks = schemaTable?.checks ?? [];
      const ddlSchema = resolveDdlSchemaForNamespace(ctx, namespaceId);

      for (const contractCheck of contractChecks) {
        const liveCheck = liveChecks.find((c) => c.name === contractCheck.name);
        const issueKey = `${tableName} ${contractCheck.name}`;
        if (!liveCheck) {
          calls.push(
            new AddCheckConstraintCall(
              ddlSchema,
              tableName,
              contractCheck.name,
              contractCheck.column,
              contractCheck.permittedValues,
            ),
          );
          handledIssueKeys.add(issueKey);
        } else if (!checkValueSetsEqual(contractCheck.permittedValues, liveCheck.permittedValues)) {
          calls.push(
            new DropCheckConstraintCall(ddlSchema, tableName, contractCheck.name),
            new AddCheckConstraintCall(
              ddlSchema,
              tableName,
              contractCheck.name,
              contractCheck.column,
              contractCheck.permittedValues,
            ),
          );
          handledIssueKeys.add(issueKey);
        }
        // else: values match — no op needed, still consume the issue
        else {
          handledIssueKeys.add(issueKey);
        }
      }

      // Emit drops for checks that are live but not in the contract.
      for (const liveCheck of liveChecks) {
        const inContract = contractChecks.some((c) => c.name === liveCheck.name);
        if (!inContract) {
          const issueKey = `${tableName} ${liveCheck.name}`;
          calls.push(new DropCheckConstraintCall(ddlSchema, tableName, liveCheck.name));
          handledIssueKeys.add(issueKey);
        }
      }
    }
  }

  if (calls.length === 0 && handledIssueKeys.size === 0) return { kind: 'no_match' };

  const remaining = issues.filter((issue) => {
    if (
      issue.kind !== 'check_missing' &&
      issue.kind !== 'check_removed' &&
      issue.kind !== 'check_mismatch'
    ) {
      return true;
    }
    if (!issue.table || !issue.indexOrConstraint) return true;
    const key = `${issue.table} ${issue.indexOrConstraint}`;
    return !handledIssueKeys.has(key);
  });

  return { kind: 'match', issues: remaining, calls };
};

/**
 * Dispatches codec-typed storage types through their codec's
 * `planTypeOperations` hook (the authoritative source for codec-driven DDL
 * such as custom type creation).
 */
export const storageTypePlanCallStrategy: CallMigrationStrategy = (issues, ctx) => {
  const storageTypes = ctx.toContract.storage.types ?? {};
  if (Object.keys(storageTypes).length === 0) return { kind: 'no_match' };

  const calls: PostgresOpFactoryCall[] = [];
  const handledTypeNames = new Set<string>();

  for (const [typeName, typeInstance] of Object.entries(storageTypes).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const codecInstance = typeInstance as StorageTypeInstance;
    const hook = ctx.codecHooks.get(codecInstance.codecId);
    if (!hook?.planTypeOperations) continue;
    const planResult = hook.planTypeOperations({
      typeName,
      typeInstance: codecInstance,
      contract: ctx.toContract,
      schema: ctx.schema,
      schemaName: ctx.schemaName,
      policy: ctx.policy,
    });
    if (!planResult) continue;
    if (planResult.operations.length === 0) {
      handledTypeNames.add(typeName);
      continue;
    }
    handledTypeNames.add(typeName);
    for (const op of planResult.operations) {
      calls.push(
        new RawSqlCall({
          ...op,
          target: {
            id: op.target.id,
            details: buildTargetDetails('type', typeName, ctx.schemaName),
          },
        } as SqlMigrationPlanOperation<PostgresPlanTargetDetails>),
      );
    }
  }

  const remaining = issues.filter(
    (issue) =>
      !(
        (issue.kind === 'type_missing' || issue.kind === 'enum_values_changed') &&
        issue.typeName &&
        handledTypeNames.has(issue.typeName)
      ),
  );

  if (calls.length === 0 && remaining.length === issues.length) {
    return { kind: 'no_match' };
  }

  return { kind: 'match', issues: remaining, calls };
};

/**
 * Handles `missing_column` issues for NOT NULL columns without a contract
 * default. Replaces the walk-schema `buildAddColumnItem` non-default branches.
 *
 * Two shapes:
 *  - Shared-temp-default safe: emit a single atomic composite op (add
 *    nullable → backfill identity value → `SET NOT NULL` → `DROP DEFAULT`).
 *  - Empty-table guarded: emit a hand-built op with a `tableIsEmptyCheck`
 *    precheck so the failure message is "table is not empty" rather than the
 *    raw PG NOT NULL violation.
 *
 * "Normal" missing_column cases (nullable or has a contract default) are left
 * for `mapIssueToCall`'s default `AddColumnCall` emission.
 */
export const notNullAddColumnCallStrategy: CallMigrationStrategy = (issues, ctx) => {
  const matched: SchemaIssue[] = [];
  const calls: PostgresOpFactoryCall[] = [];

  const schemaLookups = buildSchemaLookupMap(ctx.schema);

  const mutableCodecHooks = ctx.codecHooks as Map<string, CodecControlHooks>;
  const mutableStorageTypes = ctx.storageTypes as Record<string, StorageTypeInstance>;

  for (const issue of issues) {
    if (issue.kind !== 'missing_column' || !issue.table || !issue.column) continue;
    const namespaceId = resolveNamespaceIdForIssue(issue);
    const contractTable = tableAt(ctx.toContract.storage, namespaceId, issue.table);
    const column = contractTable?.columns[issue.column];
    if (!column) continue;

    const notNull = column.nullable !== true;
    const hasDefault = column.default !== undefined;
    if (!notNull || hasDefault) continue;

    const schemaTable = ctx.schema.tables[issue.table];
    if (!schemaTable) continue;

    const temporaryDefault = resolveIdentityValue(column, mutableCodecHooks, mutableStorageTypes);
    const schemaLookup = schemaLookups.get(issue.table);
    const canUseSharedTempDefault =
      temporaryDefault !== null &&
      canUseSharedTemporaryDefaultStrategy({
        table: contractTable,
        schemaTable,
        schemaLookup,
        columnName: issue.column,
      });

    matched.push(issue);

    const schemaForTable = resolveDdlSchemaForNamespace(ctx, namespaceId);

    if (canUseSharedTempDefault && temporaryDefault !== null) {
      calls.push(
        new RawSqlCall(
          buildAddNotNullColumnWithTemporaryDefaultOperation({
            schema: schemaForTable,
            tableName: issue.table,
            columnName: issue.column,
            column,
            codecHooks: mutableCodecHooks,
            storageTypes: mutableStorageTypes,
            temporaryDefault,
          }),
        ),
      );
      continue;
    }

    const qualified = qualifyTableName(schemaForTable, issue.table);
    calls.push(
      new RawSqlCall({
        ...buildAddColumnOperationIdentity(schemaForTable, issue.table, issue.column),
        operationClass: 'additive',
        precheck: [
          {
            description: `ensure column "${issue.column}" is missing`,
            sql: columnExistsCheck({
              schema: schemaForTable,
              table: issue.table,
              column: issue.column,
              exists: false,
            }),
          },
          {
            description: `ensure table "${issue.table}" is empty before adding NOT NULL column without default`,
            sql: tableIsEmptyCheck(qualified),
          },
        ],
        execute: [
          {
            description: `add column "${issue.column}"`,
            sql: buildAddColumnSql(
              qualified,
              issue.column,
              column,
              mutableCodecHooks,
              undefined,
              mutableStorageTypes,
            ),
          },
        ],
        postcheck: [
          {
            description: `verify column "${issue.column}" exists`,
            sql: columnExistsCheck({
              schema: schemaForTable,
              table: issue.table,
              column: issue.column,
            }),
          },
          {
            description: `verify column "${issue.column}" is NOT NULL`,
            sql: columnNullabilityCheck({
              schema: schemaForTable,
              table: issue.table,
              column: issue.column,
              nullable: false,
            }),
          },
        ],
      }),
    );
  }

  if (matched.length === 0) return { kind: 'no_match' };
  return {
    kind: 'match',
    issues: issues.filter((i) => !matched.includes(i)),
    calls,
  };
};

// ============================================================================
// Strategy helpers
// ============================================================================

function canUseSharedTemporaryDefaultStrategy(options: {
  readonly table: StorageTable;
  readonly schemaTable: SqlSchemaIR['tables'][string];
  readonly schemaLookup: ReturnType<typeof buildSchemaLookupMap> extends ReadonlyMap<
    string,
    infer V
  >
    ? V | undefined
    : never;
  readonly columnName: string;
}): boolean {
  const { table, schemaTable, schemaLookup, columnName } = options;

  if (table.primaryKey?.columns.includes(columnName) && !schemaTable.primaryKey) {
    return false;
  }

  for (const unique of table.uniques) {
    if (!unique.columns.includes(columnName)) continue;
    if (!schemaLookup || !hasUniqueConstraint(schemaLookup, unique.columns)) return false;
  }

  for (const foreignKey of table.foreignKeys) {
    if (foreignKey.constraint === false || !foreignKey.source.columns.includes(columnName))
      continue;
    if (!schemaLookup || !hasForeignKey(schemaLookup, foreignKey)) return false;
  }

  return true;
}

/**
 * Ordered list of Postgres planner strategies, shared by `migration plan`
 * and `db update` / `db init`. The issue planner runs each strategy in
 * order, letting it consume any issues it handles, and routes whatever's
 * left through `mapIssueToCall`. Behavior diverges purely on
 * `policy.allowedOperationClasses`:
 *
 * - When `'data'` is allowed (`migration plan`), the data-safe strategies
 *   (`notNullBackfillCallStrategy`, `typeChangeCallStrategy`,
 *   `nullableTighteningCallStrategy`) consume their matching issues and emit
 *   `DataTransformCall` placeholders or recipe ops.
 *
 * - When `'data'` is not allowed (`db update` / `db init`), the
 *   placeholder-emitting strategies short-circuit to `no_match`, leaving
 *   the issue for the downstream walk-schema strategies
 *   (`storageTypePlanCallStrategy`, `notNullAddColumnCallStrategy`) or the
 *   `mapIssueToCall` default to handle with direct DDL.
 *
 * Codec-typed storage type entries are dispatched through
 * `storageTypePlanCallStrategy`.
 */
export const postgresPlannerStrategies: readonly CallMigrationStrategy[] = [
  notNullBackfillCallStrategy,
  typeChangeCallStrategy,
  nullableTighteningCallStrategy,
  checkConstraintPlanCallStrategy,
  storageTypePlanCallStrategy,
  notNullAddColumnCallStrategy,
];
