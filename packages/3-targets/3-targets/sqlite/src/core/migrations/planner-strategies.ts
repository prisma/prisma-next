/**
 * SQLite migration strategies.
 *
 * Each strategy examines the issue list, consumes issues it handles, and
 * returns the `SqliteOpFactoryCall[]` to address them. The issue planner
 * runs each strategy in order and routes whatever's left through
 * `mapIssueToCall`.
 *
 * SQLite has no enums, no data-safe backfill, and no component-declared
 * database dependencies. The only recipe that needs strategy-level
 * multi-issue consumption is `recreateTable` (added in a later phase), which
 * absorbs type/nullability/default/constraint mismatches for a given table
 * into a single recreate operation.
 */

import type { Contract } from '@prisma-next/contract/types';
import type {
  CodecControlHooks,
  MigrationOperationClass,
  MigrationOperationPolicy,
} from '@prisma-next/family-sql/control';
import type { TargetBoundComponentDescriptor } from '@prisma-next/framework-components/components';
import type { SchemaIssue } from '@prisma-next/framework-components/control';
import type { SqlStorage, StorageTypeInstance } from '@prisma-next/sql-contract/types';
import { defaultIndexName } from '@prisma-next/sql-schema-ir/naming';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import { toTableSpec } from './issue-planner';
import { DataTransformCall, RecreateTableCall, type SqliteOpFactoryCall } from './op-factory-call';
import type { SqliteIndexSpec } from './operations/shared';

export interface StrategyContext {
  readonly toContract: Contract<SqlStorage>;
  readonly fromContract: Contract<SqlStorage> | null;
  readonly codecHooks: ReadonlyMap<string, CodecControlHooks>;
  readonly storageTypes: Readonly<Record<string, StorageTypeInstance>>;
  readonly schema: SqlSchemaIR;
  readonly policy: MigrationOperationPolicy;
  readonly frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<'sql', string>>;
}

export type CallMigrationStrategy = (
  issues: readonly SchemaIssue[],
  context: StrategyContext,
) =>
  | {
      kind: 'match';
      issues: readonly SchemaIssue[];
      calls: readonly SqliteOpFactoryCall[];
      recipe?: boolean;
    }
  | { kind: 'no_match' };

// ============================================================================
// Recreate-table strategy
// ============================================================================

const WIDENING_ISSUE_KINDS = new Set<SchemaIssue['kind']>(['default_mismatch', 'default_missing']);

const DESTRUCTIVE_ISSUE_KINDS = new Set<SchemaIssue['kind']>([
  'extra_default',
  'type_mismatch',
  'primary_key_mismatch',
  'foreign_key_mismatch',
  'unique_constraint_mismatch',
  'extra_foreign_key',
  'extra_unique_constraint',
  'extra_primary_key',
]);

function classifyIssue(issue: SchemaIssue): 'widening' | 'destructive' | null {
  if (issue.kind === 'enum_values_changed') return null;
  if (!issue.table) return null;
  if (issue.kind === 'nullability_mismatch') {
    // Relaxing (NOT NULL → nullable) is widening; tightening is destructive.
    return issue.expected === 'true' ? 'widening' : 'destructive';
  }
  if (WIDENING_ISSUE_KINDS.has(issue.kind)) return 'widening';
  if (DESTRUCTIVE_ISSUE_KINDS.has(issue.kind)) return 'destructive';
  return null;
}

/**
 * Groups recreate-eligible issues by table, decides per-table operation class
 * (destructive wins over widening), and emits one `RecreateTableCall` per
 * table. Returns unchanged-or-smaller issue list — issues the strategy
 * consumed are removed so `mapIssueToCall` doesn't double-handle them.
 */
export const recreateTableStrategy: CallMigrationStrategy = (issues, ctx) => {
  const byTable = new Map<string, { issues: SchemaIssue[]; hasDestructive: boolean }>();
  const consumed = new Set<SchemaIssue>();

  for (const issue of issues) {
    const cls = classifyIssue(issue);
    if (!cls) continue;
    if (issue.kind === 'enum_values_changed') continue;
    if (!issue.table) continue;
    const table = issue.table;
    const entry = byTable.get(table);
    if (entry) {
      entry.issues.push(issue);
      if (cls === 'destructive') entry.hasDestructive = true;
    } else {
      byTable.set(table, { issues: [issue], hasDestructive: cls === 'destructive' });
    }
    consumed.add(issue);
  }

  if (byTable.size === 0) return { kind: 'no_match' };

  const calls: SqliteOpFactoryCall[] = [];
  for (const [tableName, entry] of byTable) {
    const contractTable = ctx.toContract.storage.tables[tableName];
    const schemaTable = ctx.schema.tables[tableName];
    if (!contractTable || !schemaTable) continue;
    const operationClass: MigrationOperationClass = entry.hasDestructive
      ? 'destructive'
      : 'widening';

    // Flatten the contract table to a self-contained spec — the Call holds
    // pre-rendered SQL fragments only, no `StorageColumn` or `storageTypes`.
    const tableSpec = toTableSpec(contractTable, ctx.storageTypes);

    const seenIndexColumnKeys = new Set<string>();
    const indexes: SqliteIndexSpec[] = [];
    for (const idx of contractTable.indexes) {
      const key = idx.columns.join(',');
      if (seenIndexColumnKeys.has(key)) continue;
      seenIndexColumnKeys.add(key);
      indexes.push({
        name: idx.name ?? defaultIndexName(tableName, idx.columns),
        columns: idx.columns,
      });
    }
    for (const fk of contractTable.foreignKeys) {
      if (fk.index === false) continue;
      const key = fk.columns.join(',');
      if (seenIndexColumnKeys.has(key)) continue;
      seenIndexColumnKeys.add(key);
      indexes.push({
        name: defaultIndexName(tableName, fk.columns),
        columns: fk.columns,
      });
    }

    calls.push(
      new RecreateTableCall({
        tableName,
        contractTable: tableSpec,
        schemaColumnNames: Object.keys(schemaTable.columns),
        indexes,
        issues: entry.issues,
        operationClass,
      }),
    );
  }

  return {
    kind: 'match',
    issues: issues.filter((i) => !consumed.has(i)),
    calls,
    recipe: true,
  };
};

// ============================================================================
// Nullability-tightening backfill strategy
// ============================================================================

/**
 * When the policy allows `'data'` and the contract tightens one or more
 * columns from nullable to NOT NULL, emit a `DataTransformCall` stub per
 * tightened column. The user fills the backfill `UPDATE` in the rendered
 * `migration.ts` before the subsequent `RecreateTableCall` copies data into
 * the tightened schema (whose `INSERT INTO temp SELECT … FROM old` would
 * otherwise fail at runtime if any `NULL`s remain).
 *
 * Does NOT consume the tightening issue — `recreateTableStrategy` still
 * needs it to produce the actual recreate that enforces the NOT NULL at
 * the schema level. The backfill op and the recreate op end up in the
 * recipe slot in strategy order (backfill first, recreate second), which
 * matches the required execution order.
 *
 * Mirrors Postgres's `nullableTighteningCallStrategy` / `'data'`-class
 * gating. When `'data'` is not in the policy (the default `db update` /
 * `db init` path), the strategy short-circuits and the recreate alone
 * runs with its current destructive-class gating — preserving today's
 * behavior where a tightening blows up at runtime if NULLs are present.
 */
export const nullabilityTighteningBackfillStrategy: CallMigrationStrategy = (issues, ctx) => {
  if (!ctx.policy.allowedOperationClasses.includes('data')) {
    return { kind: 'no_match' };
  }

  const calls: SqliteOpFactoryCall[] = [];
  for (const issue of issues) {
    if (issue.kind !== 'nullability_mismatch') continue;
    if (!issue.table || !issue.column) continue;
    // Tightening only: `expected === 'true'` means the contract wants the
    // column nullable (relaxing from NOT NULL → nullable), which is safe and
    // needs no backfill.
    if (issue.expected === 'true') continue;

    const column = ctx.toContract.storage.tables[issue.table]?.columns[issue.column];
    if (!column || column.nullable === true) continue;

    calls.push(new DataTransformCall(issue.table, issue.column));
  }

  if (calls.length === 0) return { kind: 'no_match' };

  return {
    kind: 'match',
    issues,
    calls,
    recipe: true,
  };
};

export const sqlitePlannerStrategies: readonly CallMigrationStrategy[] = [
  nullabilityTighteningBackfillStrategy,
  recreateTableStrategy,
];
