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
// Node-based flip (W5) — additive, unused until the cutover renames these
// into place and deletes the coordinate-based strategies above.
import type { SchemaDiffIssue, SchemaIssue } from '@prisma-next/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import type {
  SqlStorage,
  StorageTable,
  StorageTypeInstance,
} from '@prisma-next/sql-contract/types';
import { defaultIndexName } from '@prisma-next/sql-schema-ir/naming';
import {
  RelationalSchemaNodeKind,
  type SqlColumnIR,
  type SqlSchemaIR,
} from '@prisma-next/sql-schema-ir/types';
import { blindCast } from '@prisma-next/utils/casts';
import { columnTypeChanged, tableSpecFromNode, toTableSpec } from './issue-planner';
import { DataTransformCall, RecreateTableCall, type SqliteOpFactoryCall } from './op-factory-call';
import type { SqliteIndexSpec } from './operations/shared';
import {
  buildRecreatePostchecks,
  buildRecreatePostchecksOnDiff,
  buildRecreateSummary,
  buildRecreateSummaryOnDiff,
} from './operations/tables';

export interface StrategyContext {
  readonly toContract: Contract<SqlStorage>;
  readonly fromContract: Contract<SqlStorage> | null;
  readonly codecHooks: ReadonlyMap<string, CodecControlHooks>;
  readonly storageTypes: Readonly<Record<string, StorageTypeInstance>>;
  readonly schema: SqlSchemaIR;
  readonly policy: MigrationOperationPolicy;
  readonly frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<'sql', string>>;
}

/**
 * Look up a storage table by its explicit namespace coordinate. Returns
 * `undefined` when the namespace has no table by that name (or no such
 * namespace exists). Callers that get `undefined` MUST treat it as an
 * explicit conflict rather than silently falling back to a name-only
 * walk across namespaces — the SQLite target currently has a single
 * namespace, but this helper enforces the explicit-coordinate
 * discipline so a future multi-namespace SQLite shape inherits the
 * conflict-on-stale-coordinate behaviour the Postgres planner already
 * has.
 */
export function tableAt(
  storage: SqlStorage,
  namespaceId: string,
  tableName: string,
): StorageTable | undefined {
  const ns = storage.namespaces[namespaceId];
  return ns !== undefined ? ns.entries.table?.[tableName] : undefined;
}

/**
 * Default namespace coordinate for an issue that does not carry one
 * explicitly. Hand-crafted unit-test issues fall back to `__unbound__`,
 * the only namespace any single-namespace contract carries —
 * verifier-emitted issues for legacy single-namespace contracts already
 * stamp this id explicitly. Typed structurally so issue variants
 * without a `namespaceId` slot flow through to the same fallback.
 */
export function resolveNamespaceIdForIssue(issue: { readonly namespaceId?: string }): string {
  return issue.namespaceId ?? UNBOUND_NAMESPACE_ID;
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
  const byTable = new Map<
    string,
    { issues: SchemaIssue[]; hasDestructive: boolean; namespaceId: string }
  >();
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
      byTable.set(table, {
        issues: [issue],
        hasDestructive: cls === 'destructive',
        namespaceId: resolveNamespaceIdForIssue(issue),
      });
    }
    consumed.add(issue);
  }

  if (byTable.size === 0) return { kind: 'no_match' };

  const calls: SqliteOpFactoryCall[] = [];
  for (const [tableName, entry] of byTable) {
    const contractTable = tableAt(ctx.toContract.storage, entry.namespaceId, tableName);
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
      const key = fk.source.columns.join(',');
      if (seenIndexColumnKeys.has(key)) continue;
      seenIndexColumnKeys.add(key);
      indexes.push({
        name: defaultIndexName(tableName, fk.source.columns),
        columns: fk.source.columns,
      });
    }

    calls.push(
      new RecreateTableCall({
        tableName,
        contractTable: tableSpec,
        schemaColumnNames: Object.keys(schemaTable.columns),
        indexes,
        summary: buildRecreateSummary(tableName, entry.issues),
        postchecks: buildRecreatePostchecks(tableName, entry.issues, tableSpec),
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

    const namespaceId = resolveNamespaceIdForIssue(issue);
    const column = tableAt(ctx.toContract.storage, namespaceId, issue.table)?.columns[issue.column];
    if (!column || column.nullable === true) continue;

    calls.push(
      new DataTransformCall(
        `data_migration.backfill-${issue.table}-${issue.column}`,
        `Backfill NULLs in "${issue.table}"."${issue.column}" before NOT NULL tightening`,
        issue.table,
        issue.column,
      ),
    );
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

// ============================================================================
// The node-based flip (W5) — additive, unwired
// ============================================================================
//
// Node-typed siblings of the strategies above, reading `SchemaDiffIssue`s and
// the start/end (`actual`/`expected`) schema-IR tree pair instead of
// `toContract`/`fromContract`/`codecHooks`/`storageTypes`. Not consumed by
// `planIssues` yet — the cutover commit deletes the coordinate-based
// strategies above, drops the `OnDiff` suffix from these, and renames
// `NodeStrategyContext` to `StrategyContext`.

export interface NodeStrategyContext {
  /** The desired ("end") tree — resolved leaf values, `opRender` stamped. */
  readonly expected: SqlSchemaIR;
  /** The live ("start") tree. */
  readonly actual: SqlSchemaIR;
  readonly policy: MigrationOperationPolicy;
  readonly frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<'sql', string>>;
}

export type NodeCallMigrationStrategy = (
  issues: readonly SchemaDiffIssue[],
  context: NodeStrategyContext,
) =>
  | {
      kind: 'match';
      issues: readonly SchemaDiffIssue[];
      calls: readonly SqliteOpFactoryCall[];
      recipe?: boolean;
    }
  | { kind: 'no_match' };

/**
 * Classifies a node issue into the operation class a recreate absorbing it
 * would need, or `null` when the strategy doesn't handle this node/reason at
 * all (table/column not-found-or-not-expected, and index issues — those are
 * standalone ops, never folded into a recreate).
 *
 * Column drift is a single `not-equal` issue now (type AND nullability
 * compared together by `SqlColumnIR.isEqualTo`), so this reads both fields
 * off the node pair directly rather than trusting a separate issue kind per
 * attribute: a type change is always destructive; a pure nullability change
 * is destructive when tightening (NOT NULL required) and widening when
 * relaxing.
 */
function classifyNodeIssue(issue: SchemaDiffIssue): 'widening' | 'destructive' | null {
  const node = issue.expected ?? issue.actual;
  if (node === undefined) return null;
  const nodeKind = blindCast<
    { readonly nodeKind: string },
    'every diff-tree node declares nodeKind'
  >(node).nodeKind;
  switch (nodeKind) {
    case RelationalSchemaNodeKind.column: {
      if (issue.reason !== 'not-equal') return null;
      const expected = blindCast<SqlColumnIR, 'a not-equal column issue carries the expected node'>(
        issue.expected,
      );
      const actual = blindCast<SqlColumnIR, 'a not-equal column issue carries the actual node'>(
        issue.actual,
      );
      if (columnTypeChanged(expected, actual)) return 'destructive';
      // Type is unchanged, so `not-equal` here means only nullability
      // differs: relaxing (NOT NULL → nullable) is safe; tightening is not.
      return expected.nullable ? 'widening' : 'destructive';
    }
    case RelationalSchemaNodeKind.columnDefault:
      return issue.reason === 'not-expected' ? 'destructive' : 'widening';
    case RelationalSchemaNodeKind.primaryKey:
    case RelationalSchemaNodeKind.foreignKey:
    case RelationalSchemaNodeKind.unique:
      return 'destructive';
    default:
      return null;
  }
}

/**
 * Node-based sibling of `recreateTableStrategy`. Groups recreate-eligible
 * issues by table, decides per-table operation class (destructive wins over
 * widening), and emits one `RecreateTableCall` per table. The full desired/
 * live table shapes come from `ctx.expected`/`ctx.actual` directly (keyed by
 * table name — SQLite is a flat, single-namespace target) rather than from
 * any individual issue, since a single drifted attribute's issue only
 * carries that attribute's own node, never the whole table.
 */
export const recreateTableStrategyOnDiff: NodeCallMigrationStrategy = (issues, ctx) => {
  const byTable = new Map<string, { issues: SchemaDiffIssue[]; hasDestructive: boolean }>();
  const consumed = new Set<SchemaDiffIssue>();

  for (const issue of issues) {
    const cls = classifyNodeIssue(issue);
    if (!cls) continue;
    const tableName = issue.path[1];
    if (tableName === undefined) continue;
    const entry = byTable.get(tableName);
    if (entry) {
      entry.issues.push(issue);
      if (cls === 'destructive') entry.hasDestructive = true;
    } else {
      byTable.set(tableName, { issues: [issue], hasDestructive: cls === 'destructive' });
    }
    consumed.add(issue);
  }

  if (byTable.size === 0) return { kind: 'no_match' };

  const calls: SqliteOpFactoryCall[] = [];
  for (const [tableName, entry] of byTable) {
    const expectedTable = ctx.expected.tables[tableName];
    const actualTable = ctx.actual.tables[tableName];
    if (!expectedTable || !actualTable) continue;
    const operationClass: MigrationOperationClass = entry.hasDestructive
      ? 'destructive'
      : 'widening';

    // Flatten the expected table node to a self-contained spec — the Call
    // holds pre-rendered SQL fragments only, no schema-IR node.
    const tableSpec = tableSpecFromNode(expectedTable);

    // Indexes (declared + FK-backing) are already merged and deduped by
    // column-set at derivation (`contractToSchemaIR`'s `convertTable`).
    const indexes: SqliteIndexSpec[] = expectedTable.indexes.map((idx) => ({
      name: idx.name ?? defaultIndexName(tableName, idx.columns),
      columns: idx.columns,
    }));

    calls.push(
      new RecreateTableCall({
        tableName,
        contractTable: tableSpec,
        schemaColumnNames: Object.keys(actualTable.columns),
        indexes,
        summary: buildRecreateSummaryOnDiff(tableName, entry.issues),
        postchecks: buildRecreatePostchecksOnDiff(tableName, entry.issues, tableSpec),
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

/**
 * Node-based sibling of `nullabilityTighteningBackfillStrategy`. Does NOT
 * consume the tightening issue — `recreateTableStrategyOnDiff` still needs
 * it to produce the actual recreate that enforces the NOT NULL at the
 * schema level.
 */
export const nullabilityTighteningBackfillStrategyOnDiff: NodeCallMigrationStrategy = (
  issues,
  ctx,
) => {
  if (!ctx.policy.allowedOperationClasses.includes('data')) {
    return { kind: 'no_match' };
  }

  const calls: SqliteOpFactoryCall[] = [];
  for (const issue of issues) {
    if (
      issue.reason !== 'not-equal' ||
      issue.expected === undefined ||
      issue.actual === undefined
    ) {
      continue;
    }
    const nodeKind = blindCast<
      { readonly nodeKind: string },
      'every diff-tree node declares nodeKind'
    >(issue.expected).nodeKind;
    if (nodeKind !== RelationalSchemaNodeKind.column) continue;

    const expectedColumn = blindCast<
      SqlColumnIR,
      'a not-equal column issue carries the expected node'
    >(issue.expected);
    const actualColumn = blindCast<SqlColumnIR, 'a not-equal column issue carries the actual node'>(
      issue.actual,
    );
    if (expectedColumn.nullable === actualColumn.nullable) continue; // not a nullability change
    if (expectedColumn.nullable) continue; // relaxing — no backfill needed

    const tableName = issue.path[1];
    if (tableName === undefined) continue;

    calls.push(
      new DataTransformCall(
        `data_migration.backfill-${tableName}-${expectedColumn.name}`,
        `Backfill NULLs in "${tableName}"."${expectedColumn.name}" before NOT NULL tightening`,
        tableName,
        expectedColumn.name,
      ),
    );
  }

  if (calls.length === 0) return { kind: 'no_match' };

  return {
    kind: 'match',
    issues,
    calls,
    recipe: true,
  };
};

export const sqlitePlannerStrategiesOnDiff: readonly NodeCallMigrationStrategy[] = [
  nullabilityTighteningBackfillStrategyOnDiff,
  recreateTableStrategyOnDiff,
];
