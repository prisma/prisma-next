/**
 * Migration strategies for the descriptor-based planner.
 *
 * Each strategy examines the issue list, consumes issues it handles,
 * and returns the ops to handle them. The planner chains strategies,
 * then handles whatever's left with default issue-to-descriptor mapping.
 *
 * Different strategy sets are used for different contexts:
 * - `migration plan`: data-safe strategies (dataTransform for NOT NULL, type changes, etc.)
 * - `db update`: dev-push strategies (temp defaults, destructive type changes, no data transforms)
 */

import type { Contract } from '@prisma-next/contract/types';
import type { CodecControlHooks } from '@prisma-next/family-sql/control';
import type { SchemaIssue } from '@prisma-next/framework-components/control';
import type { SqlStorage, StorageTypeInstance } from '@prisma-next/sql-contract/types';
import {
  addColumn,
  addEnumValues,
  alterColumnType,
  createEnumType,
  dataTransform,
  dropEnumType,
  type PostgresMigrationOpDescriptor,
  renameType,
  setNotNull,
  TODO,
} from './operation-descriptors';

// ============================================================================
// Strategy types
// ============================================================================

/** Context passed to each migration strategy — the from/to contracts for the migration. */
export interface StrategyContext {
  readonly toContract: Contract<SqlStorage>;
  readonly fromContract: Contract<SqlStorage> | null;
  readonly schemaName: string;
  readonly codecHooks: ReadonlyMap<string, CodecControlHooks>;
  readonly storageTypes: Readonly<Record<string, StorageTypeInstance>>;
}

/**
 * A migration strategy examines schema issues, consumes the ones it handles,
 * and returns the descriptor ops to address them. Returns `'no_match'` if
 * none of the issues are relevant. The planner chains strategies in order —
 * earlier strategies consume issues before later ones see them.
 */
export type MigrationStrategy = (
  issues: readonly SchemaIssue[],
  context: StrategyContext,
) =>
  | { kind: 'match'; issues: readonly SchemaIssue[]; ops: readonly PostgresMigrationOpDescriptor[] }
  | { kind: 'no_match' };

// ============================================================================
// Recipes
// ============================================================================

const REBUILD_SUFFIX = '__prisma_next_new';

/**
 * Produces the descriptor sequence for rebuilding a Postgres enum type:
 *   createEnumType(temp, values) → alterColumnType(USING cast) per column → dropEnumType(old) → renameType(temp, old)
 *
 * Used by the enum change strategy for value removal and reorder scenarios.
 * Finds all columns referencing the enum via `typeRef` in the destination contract.
 */
function enumRebuildRecipe(
  typeName: string,
  ctx: StrategyContext,
): readonly PostgresMigrationOpDescriptor[] {
  const toType = ctx.toContract.storage.types?.[typeName];
  if (!toType) return [];
  const nativeType = toType.nativeType;
  const desiredValues = (toType.typeParams['values'] ?? []) as readonly string[];
  const tempName = `${nativeType}${REBUILD_SUFFIX}`;

  const columnRefs: { table: string; column: string }[] = [];
  for (const [tableName, table] of Object.entries(ctx.toContract.storage.tables)) {
    for (const [columnName, column] of Object.entries(table.columns)) {
      if (column.typeRef === typeName) {
        columnRefs.push({ table: tableName, column: columnName });
      }
    }
  }

  return [
    createEnumType(tempName, desiredValues),
    ...columnRefs.map((ref) =>
      alterColumnType(ref.table, ref.column, {
        toType: tempName,
        using: `${ref.column}::text::${tempName}`,
      }),
    ),
    dropEnumType(nativeType),
    renameType(tempName, nativeType),
  ];
}

// ============================================================================
// Data-safe strategies (for `migration plan`)
// ============================================================================

/**
 * NOT NULL backfill strategy.
 *
 * When a missing column is NOT NULL without a default, the planner can't just
 * add it — existing rows would violate the constraint. Instead, emit:
 *   addColumn(nullable) → dataTransform (user fills in backfill) → setNotNull
 */
export const notNullBackfillStrategy: MigrationStrategy = (issues, ctx) => {
  const matched: SchemaIssue[] = [];
  const ops: PostgresMigrationOpDescriptor[] = [];

  for (const issue of issues) {
    if (issue.kind !== 'missing_column' || !issue.table || !issue.column) continue;

    const column = ctx.toContract.storage.tables[issue.table]?.columns[issue.column];
    if (!column) continue;
    if (column.nullable === true || column.default !== undefined) continue;

    matched.push(issue);
    ops.push(
      addColumn(issue.table, issue.column, { nullable: true }),
      dataTransform(`backfill-${issue.table}-${issue.column}`, {
        check: TODO,
        run: TODO,
      }),
      setNotNull(issue.table, issue.column),
    );
  }

  if (matched.length === 0) return { kind: 'no_match' };
  return {
    kind: 'match',
    issues: issues.filter((i) => !matched.includes(i)),
    ops,
  };
};

/**
 * Unsafe type change strategy.
 *
 * Safe widenings (int4 → int8) emit alterColumnType directly.
 * Unsafe changes emit dataTransform for user to handle conversion.
 */
export const typeChangeStrategy: MigrationStrategy = (issues, ctx) => {
  const matched: SchemaIssue[] = [];
  const ops: PostgresMigrationOpDescriptor[] = [];

  const SAFE_WIDENINGS = new Set(['int2→int4', 'int2→int8', 'int4→int8', 'float4→float8']);
  function isSafeWidening(fromType: string, toType: string): boolean {
    return SAFE_WIDENINGS.has(`${fromType}→${toType}`);
  }

  for (const issue of issues) {
    if (issue.kind !== 'type_mismatch') continue;
    if (!issue.table || !issue.column) continue;
    const fromColumn = ctx.fromContract?.storage.tables[issue.table]?.columns[issue.column];
    const toColumn = ctx.toContract?.storage.tables[issue.table]?.columns[issue.column];
    if (!fromColumn || !toColumn) continue;
    const fromType = fromColumn.nativeType;
    const toType = toColumn.nativeType;
    if (fromType === toType) continue;
    matched.push(issue);
    if (isSafeWidening(fromType, toType)) {
      ops.push(alterColumnType(issue.table, issue.column));
    } else {
      ops.push(
        dataTransform(`typechange-${issue.table}-${issue.column}`, {
          check: TODO,
          run: TODO,
        }),
        alterColumnType(issue.table, issue.column),
      );
    }
  }
  if (matched.length === 0) return { kind: 'no_match' };
  return {
    kind: 'match',
    issues: issues.filter((i) => !matched.includes(i)),
    ops,
  };
};

/**
 * Nullable → NOT NULL tightening strategy.
 *
 * When an existing column changes from nullable to NOT NULL, existing rows
 * may have NULLs that violate the constraint. Emit:
 *   dataTransform (user fills in NULL handling) → setNotNull
 */
export const nullableTighteningStrategy: MigrationStrategy = (issues, ctx) => {
  const matched: SchemaIssue[] = [];
  const ops: PostgresMigrationOpDescriptor[] = [];

  for (const issue of issues) {
    if (issue.kind !== 'nullability_mismatch' || !issue.table || !issue.column) continue;

    const column = ctx.toContract.storage.tables[issue.table]?.columns[issue.column];
    if (!column) continue;
    if (column.nullable === true) continue;

    matched.push(issue);
    ops.push(
      dataTransform(`handle-nulls-${issue.table}-${issue.column}`, {
        check: TODO,
        run: TODO,
      }),
      setNotNull(issue.table, issue.column),
    );
  }

  if (matched.length === 0) return { kind: 'no_match' };
  return {
    kind: 'match',
    issues: issues.filter((i) => !matched.includes(i)),
    ops,
  };
};

/**
 * Enum value change strategy.
 *
 * When enum values change between contracts:
 * - Add only → addEnumValues
 * - Reorder (same values, different order) → rebuild recipe (no data transform)
 * - Removal → dataTransform (user migrates rows) + rebuild recipe
 */
export const enumChangeStrategy: MigrationStrategy = (issues, ctx) => {
  const matched: SchemaIssue[] = [];
  const ops: PostgresMigrationOpDescriptor[] = [];

  for (const issue of issues) {
    if (issue.kind !== 'enum_values_changed') continue;
    matched.push(issue);

    if (issue.removedValues.length > 0) {
      ops.push(
        dataTransform(`migrate-${issue.typeName}-values`, { check: TODO, run: TODO }),
        ...enumRebuildRecipe(issue.typeName, ctx),
      );
    } else if (issue.addedValues.length === 0) {
      // Reorder only — rebuild without data transform
      ops.push(...enumRebuildRecipe(issue.typeName, ctx));
    } else {
      ops.push(addEnumValues(issue.typeName, issue.addedValues));
    }
  }

  if (matched.length === 0) return { kind: 'no_match' };
  return {
    kind: 'match',
    issues: issues.filter((i) => !matched.includes(i)),
    ops,
  };
};

/** Default strategy set for `migration plan` — data-safe, requires user input for destructive changes. */
export const migrationPlanStrategies: readonly MigrationStrategy[] = [
  enumChangeStrategy,
  notNullBackfillStrategy,
  typeChangeStrategy,
  nullableTighteningStrategy,
];
