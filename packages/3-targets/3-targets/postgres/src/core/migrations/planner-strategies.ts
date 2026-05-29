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
 *   nullability tightening, unsafe type changes, enum shrink/rebuild) emit
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
import type { TargetBoundComponentDescriptor } from '@prisma-next/framework-components/components';
import type { SchemaIssue } from '@prisma-next/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import {
  isPostgresEnumStorageEntry,
  type PostgresEnumStorageEntry,
  type SqlStorage,
  type StorageTable,
  type StorageTypeInstance,
} from '@prisma-next/sql-contract/types';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import { PostgresEnumType } from '../postgres-enum-type';
import { isPostgresSchema } from '../postgres-schema';
import {
  determineEnumDiff,
  readExistingEnumValues,
  resolveDdlSchemaForNamespaceStorage,
} from './enum-planning';
import {
  AddColumnCall,
  AddEnumValuesCall,
  AlterColumnTypeCall,
  CreateEnumTypeCall,
  DataTransformCall,
  DropEnumTypeCall,
  type PostgresOpFactoryCall,
  RawSqlCall,
  RenameTypeCall,
  SetNotNullCall,
} from './op-factory-call';
import {
  buildAddColumnSql,
  buildColumnDefaultSql,
  buildColumnTypeSql,
} from './planner-ddl-builders';
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

const REBUILD_SUFFIX = '__prisma_next_new';

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
  // Namespace.tables is typed as Record<string, IRNode> at the interface level;
  // SQL family namespaces always hold StorageTable instances.
  return storage.namespaces[namespaceId]?.tables[tableName] as StorageTable | undefined;
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
 * named schemas return their own id and the unbound singleton projects
 * to `'public'` (sibling-present) or the framework sentinel
 * (sibling-absent). Legacy single-namespace contracts whose `__unbound__`
 * slot is the framework-default `SqlUnboundNamespace` (rather than the
 * Postgres-aware `PostgresUnboundSchema`) flow the coordinate through
 * unchanged so downstream `qualifyTableName` resolves polymorphically.
 */
export function resolveDdlSchemaForNamespace(ctx: StrategyContext, namespaceId: string): string {
  const namespace = ctx.toContract.storage.namespaces[namespaceId];
  if (isPostgresSchema(namespace)) {
    return namespace.ddlSchemaName(ctx.toContract.storage);
  }
  return namespaceId;
}

/**
 * Finds a type entry by explicit namespace coordinate. Namespace types (e.g.
 * Postgres enums) live under `storage.namespaces[nsId].enum`. Returns the
 * entry from the named namespace only — never scans other namespaces, so two
 * namespaces that hold an enum with the same name resolve independently.
 */
function locateNamespaceType(
  storage: SqlStorage,
  namespaceId: string,
  typeName: string,
): PostgresEnumStorageEntry | undefined {
  const ns = storage.namespaces[namespaceId];
  if (!ns || !('enum' in ns) || ns.enum == null) return undefined;
  return (ns.enum as Record<string, PostgresEnumStorageEntry>)[typeName];
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
  readonly storageTypes: Readonly<Record<string, StorageTypeInstance | PostgresEnumStorageEntry>>;
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
       * `nativeEnumPlanCallStrategy` (createEnumType → alterColumnType →
       * dropEnumType → renameType, optionally prefixed by a
       * `DataTransformCall` placeholder), `notNullBackfillCallStrategy`
       * (addColumn → dataTransform → setNotNull). Defaults to `false`,
       * which lets `planIssues` hoist individual calls into their DDL
       * sequencing bucket.
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
) {
  const col = tableAt(ctx.toContract.storage, namespaceId, table)?.columns[column];
  if (!col) throw new Error(`Column "${table}"."${column}" not found in destination contract`);
  const mutableHooks = ctx.codecHooks as Map<string, CodecControlHooks>;
  const mutableTypes = ctx.storageTypes as Record<
    string,
    StorageTypeInstance | PostgresEnumStorageEntry
  >;
  return {
    name: column,
    typeSql: buildColumnTypeSql(col, mutableHooks, mutableTypes),
    defaultSql: buildColumnDefaultSql(col.default, col),
    nullable: overrides?.nullable ?? col.nullable,
  };
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
  const mutableTypes = ctx.storageTypes as Record<
    string,
    StorageTypeInstance | PostgresEnumStorageEntry
  >;
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

function enumRebuildCallRecipe(
  namespaceId: string,
  typeName: string,
  ctx: StrategyContext,
): readonly PostgresOpFactoryCall[] {
  const toType = locateNamespaceType(ctx.toContract.storage, namespaceId, typeName);
  if (!toType) return [];
  const isEnum = isPostgresEnumStorageEntry(toType);
  const nativeType = toType.nativeType;
  const desiredValues: readonly string[] = isEnum
    ? toType.values
    : (((toType as StorageTypeInstance).typeParams['values'] ?? []) as readonly string[]);
  const tempName = `${nativeType}${REBUILD_SUFFIX}`;
  const ddlSchema = resolveDdlSchemaForNamespace(ctx, namespaceId);

  const columnRefs: { namespaceId: string; table: string; column: string }[] = [];
  for (const [nsId, ns] of Object.entries(ctx.toContract.storage.namespaces)) {
    for (const [tableName, tableNode] of Object.entries(ns.tables)) {
      const table = tableNode as StorageTable;
      for (const [columnName, column] of Object.entries(table.columns)) {
        if (column.typeRef === typeName && nsId === namespaceId) {
          columnRefs.push({ namespaceId: nsId, table: tableName, column: columnName });
        }
      }
    }
  }

  return [
    new CreateEnumTypeCall(ddlSchema, tempName, desiredValues),
    ...columnRefs.map((ref) => {
      const using = `${ref.column}::text::${tempName}`;
      return new AlterColumnTypeCall(
        resolveDdlSchemaForNamespace(ctx, ref.namespaceId),
        ref.table,
        ref.column,
        {
          qualifiedTargetType: tempName,
          formatTypeExpected: tempName,
          rawTargetTypeForLabel: tempName,
          using,
        },
      );
    }),
    new DropEnumTypeCall(ddlSchema, nativeType),
    new RenameTypeCall(ddlSchema, tempName, nativeType),
  ];
}

// ============================================================================
// Native enum planner strategy
// ============================================================================

/**
 * Single planner strategy for `PostgresEnumType` instances. Walks
 * `toContract.storage.types` directly (no codec-hook dispatch) and
 * resolves existing values via `readExistingEnumValues`, the same
 * Postgres bridging adapter the verifier uses.
 *
 * Per-enum dispatch:
 *
 * - No existing type → `CreateEnumTypeCall` with the contract's desired
 *   values.
 * - Diff is `unchanged` → no calls emitted (consumes the matching
 *   `enum_values_changed` issue if present).
 * - Diff is `add_values` → `AddEnumValuesCall` with the new labels.
 * - Diff is `rebuild` → the create-temp / migrate-columns /
 *   drop-original / rename rebuild recipe. When
 *   `policy.allowedOperationClasses` includes `'data'` and the rebuild
 *   removes labels (`removedValues.length > 0`), prepend a
 *   `DataTransformCall` placeholder so the user can author the value
 *   remap before the destructive recipe runs. Without `'data'` in the
 *   policy (`db update` / `db init`), the rebuild's PG `USING ::text`
 *   cast surfaces any value-removal data loss as a runtime error rather
 *   than silent loss.
 *
 * Returns `recipe: true` only when a rebuild recipe was emitted (its
 * `createEnumType(temp) → alterColumnType → dropEnumType(orig) →
 * renameType` sequence mixes `dep`-class and `alter`-class calls that
 * would mis-order if the planner hoisted them into its DDL sequencing
 * buckets). For the create-only and add-values paths the strategy
 * returns `recipe: false` so the planner hoists `CreateEnumTypeCall`
 * into the `dep` bucket — i.e. `CREATE TYPE` runs before any
 * `CreateTableCall` that references the new enum.
 */
/**
 * Separator character for compound enum map keys (`namespaceId\u0000typeName`).
 * NUL (`\u0000`) is invalid in both Postgres identifiers and TypeScript symbol
 * names so it cannot appear in either component — unambiguous separator.
 */
const COMPOUND_KEY_SEP = '\u0000';

/** Builds the compound map key for a namespace-qualified enum entry. */
function enumCompoundKey(namespaceId: string, typeName: string): string {
  return `${namespaceId}${COMPOUND_KEY_SEP}${typeName}`;
}

export const nativeEnumPlanCallStrategy: CallMigrationStrategy = (issues, ctx) => {
  const enumTypes = collectPostgresEnumTypes(ctx.toContract.storage);
  if (enumTypes.size === 0) return { kind: 'no_match' };

  const dataAllowed = ctx.policy.allowedOperationClasses.includes('data');

  const calls: PostgresOpFactoryCall[] = [];
  const handledKeys = new Set<string>();
  const introducedKeys = new Set<string>();
  const rebuiltKeys = new Set<string>();
  let emittedRebuildRecipe = false;

  for (const [key, enumType] of enumTypes) {
    const sepIdx = key.indexOf(COMPOUND_KEY_SEP);
    const enumNamespaceId = key.slice(0, sepIdx);
    const typeName = key.slice(sepIdx + 1);

    const desired = enumType.values;
    const ddlSchema = resolveDdlSchemaForNamespace(ctx, enumNamespaceId);
    // The live-schema lookup keys by the *introspected* schema name, which for
    // the unbound namespace is the resolved `current_schema()` (not the
    // `__unbound__` DDL-emit sentinel) — see `resolveDdlSchemaForNamespaceStorage`.
    const readSchema = resolveDdlSchemaForNamespaceStorage(
      ctx.toContract.storage,
      enumNamespaceId,
      ctx.schema,
    );
    const existing = readExistingEnumValues(ctx.schema, readSchema, enumType.nativeType);
    if (!existing) {
      calls.push(new CreateEnumTypeCall(ddlSchema, typeName, desired, enumType.nativeType));
      handledKeys.add(key);
      introducedKeys.add(key);
      continue;
    }
    const diff = determineEnumDiff(existing, desired);
    if (diff.kind === 'unchanged') {
      handledKeys.add(key);
      continue;
    }
    if (diff.kind === 'add_values') {
      const ddlSchema = resolveDdlSchemaForNamespace(ctx, enumNamespaceId);
      calls.push(new AddEnumValuesCall(ddlSchema, typeName, enumType.nativeType, diff.values));
      handledKeys.add(key);
      continue;
    }
    if (dataAllowed && diff.removedValues.length > 0) {
      calls.push(
        new DataTransformCall(
          `migrate-${typeName}-values`,
          `migrate-${typeName}-values:check`,
          `migrate-${typeName}-values:run`,
        ),
      );
    }
    calls.push(...enumRebuildCallRecipe(enumNamespaceId, typeName, ctx));
    emittedRebuildRecipe = true;
    handledKeys.add(key);
    rebuiltKeys.add(key);
  }

  // The strategy emits a single `recipe` flag for the entire pass,
  // which routes every emitted call to either the contiguous recipe
  // slot (rebuild path) or the `dep` bucket (introduce / add-values
  // path). A plan that needs both shapes simultaneously cannot be
  // expressed today — the introduced `CreateEnumTypeCall` would land
  // in the recipe slot and any `CreateTableCall` referencing the new
  // enum would fail at runtime with a confusing `type "X" does not
  // exist` error. Surface the unrepresentable case here as a
  // planner-time error so the failure mode is loud, not silent.
  if (introducedKeys.size > 0 && rebuiltKeys.size > 0) {
    const introducedDisplay = [...introducedKeys]
      .sort()
      .map((k) => k.replace(COMPOUND_KEY_SEP, '.'))
      .join(', ');
    const rebuiltDisplay = [...rebuiltKeys]
      .sort()
      .map((k) => k.replace(COMPOUND_KEY_SEP, '.'))
      .join(', ');
    throw new Error(
      `nativeEnumPlanCallStrategy: cannot emit both a brand-new enum and a rebuild on a different enum in the same plan; the single recipe flag cannot route them to different buckets. Introduced: [${introducedDisplay}]; rebuilt: [${rebuiltDisplay}]. Split the strategy or grow the \`match\` return type before this case lands.`,
    );
  }

  const remaining = issues.filter(
    (issue) =>
      !(
        (issue.kind === 'type_missing' || issue.kind === 'enum_values_changed') &&
        issue.typeName &&
        handledKeys.has(enumCompoundKey(resolveNamespaceIdForIssue(issue), issue.typeName))
      ),
  );

  if (calls.length === 0 && remaining.length === issues.length) {
    return { kind: 'no_match' };
  }
  // `recipe: true` is required for the rebuild path — its
  // `createEnumType(temp) → alterColumnType → dropEnumType(orig) →
  // renameType` mixes `dep`-class and `alter`-class calls that would
  // mis-order if the planner hoisted them into its DDL sequencing
  // buckets. For the type_missing / add_values paths we want the
  // opposite: hoisted into the `dep` bucket so a brand-new
  // `CreateEnumTypeCall` runs *before* the `CreateTableCall` that
  // references it. The two cases never co-occur in the same plan
  // (introducing a new enum type and rebuilding an existing one in
  // one shot would require both buckets — a shape today's interface
  // does not surface; if that combination ever needs to land we'd
  // split this strategy or grow the `match` return type).
  return { kind: 'match', issues: remaining, calls, recipe: emittedRebuildRecipe };
};

/**
 * Collects every `PostgresEnumType` instance across all declared namespaces,
 * returning a compound-keyed map (`${namespaceId}\u0000${typeName}`). Two
 * namespaces that declare an enum with the same name produce two distinct
 * entries — no name collision, no last-write-wins.
 *
 * Entries within each namespace are sorted by name for deterministic ordering.
 */
function collectPostgresEnumTypes(storage: SqlStorage): ReadonlyMap<string, PostgresEnumType> {
  const result = new Map<string, PostgresEnumType>();
  for (const [nsId, ns] of Object.entries(storage.namespaces)) {
    if (!('enum' in ns) || ns.enum == null) continue;
    const nsEnums = ns.enum as Record<string, unknown>;
    for (const [name, instance] of Object.entries(nsEnums).sort(([a], [b]) => a.localeCompare(b))) {
      if (instance instanceof PostgresEnumType) {
        result.set(enumCompoundKey(nsId, name), instance);
      }
    }
  }
  return result;
}

/**
 * Dispatches non-enum codec-typed storage types through their codec's
 * `planTypeOperations` hook (the authoritative source for codec-driven DDL
 * such as custom type creation). Enum dispatch lives in
 * `nativeEnumPlanCallStrategy` and no longer relies on codec hooks.
 */
export const storageTypePlanCallStrategy: CallMigrationStrategy = (issues, ctx) => {
  const storageTypes = ctx.toContract.storage.types ?? {};
  if (Object.keys(storageTypes).length === 0) return { kind: 'no_match' };

  const calls: PostgresOpFactoryCall[] = [];
  const handledTypeNames = new Set<string>();

  for (const [typeName, typeInstance] of Object.entries(storageTypes).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    // Enums walk natively in `nativeEnumPlanCallStrategy`; codec-hook
    // dispatch here is reserved for genuinely codec-typed entries
    // (decimal, varchar, pgvector, …).
    if (isPostgresEnumStorageEntry(typeInstance)) continue;
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
  const mutableStorageTypes = ctx.storageTypes as Record<
    string,
    StorageTypeInstance | PostgresEnumType
  >;

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
 *   `nullableTighteningCallStrategy`) and the enum walk
 *   (`nativeEnumPlanCallStrategy`) consume their matching issues and emit
 *   `DataTransformCall` placeholders or recipe ops.
 *
 * - When `'data'` is not allowed (`db update` / `db init`), the
 *   placeholder-emitting strategies short-circuit to `no_match`, leaving
 *   the issue for the downstream walk-schema strategies
 *   (`storageTypePlanCallStrategy`, `notNullAddColumnCallStrategy`) or the
 *   `mapIssueToCall` default to handle with direct DDL.
 *   `nativeEnumPlanCallStrategy` runs in both modes; under `db update` /
 *   `db init` it emits the rebuild recipe without the data-transform
 *   placeholder so value-removal data loss surfaces as a runtime cast
 *   error rather than silent loss.
 *
 * Enum dispatch is unified into a single strategy: the
 * `nativeEnumPlanCallStrategy` decides per-emission whether to emit a
 * rebuild recipe (`recipe: true`, contiguous slot) or hoist the call
 * into the `dep` bucket (`recipe: false`, so a brand-new
 * `CreateEnumTypeCall` runs before any `CreateTableCall` referencing
 * it). Codec-typed entries continue through `storageTypePlanCallStrategy`.
 */
export const postgresPlannerStrategies: readonly CallMigrationStrategy[] = [
  notNullBackfillCallStrategy,
  typeChangeCallStrategy,
  nullableTighteningCallStrategy,
  nativeEnumPlanCallStrategy,
  storageTypePlanCallStrategy,
  notNullAddColumnCallStrategy,
];
