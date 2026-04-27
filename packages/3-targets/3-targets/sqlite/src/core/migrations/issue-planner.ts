/**
 * SQLite migration issue planner.
 *
 * Takes schema issues (from `verifySqlSchema`) and emits migration IR
 * (`SqliteOpFactoryCall[]`). Strategies consume issues they recognize and
 * produce specialized call sequences (e.g. recreateTableStrategy absorbs
 * type/nullability/default/constraint mismatches into a single recreate op);
 * remaining issues flow through `mapIssueToCall` for the default case.
 */

import type { Contract } from '@prisma-next/contract/types';
import type {
  CodecControlHooks,
  MigrationOperationPolicy,
  SqlPlannerConflict,
  SqlPlannerConflictLocation,
} from '@prisma-next/family-sql/control';
import type { TargetBoundComponentDescriptor } from '@prisma-next/framework-components/components';
import type { SchemaIssue } from '@prisma-next/framework-components/control';
import type { SqlStorage, StorageTypeInstance } from '@prisma-next/sql-contract/types';
import { defaultIndexName } from '@prisma-next/sql-schema-ir/naming';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import type { Result } from '@prisma-next/utils/result';
import { notOk, ok } from '@prisma-next/utils/result';
import {
  AddColumnCall,
  CreateIndexCall,
  CreateTableCall,
  DropColumnCall,
  DropIndexCall,
  DropTableCall,
  type SqliteOpFactoryCall,
} from './op-factory-call';
import {
  type CallMigrationStrategy,
  type StrategyContext,
  sqlitePlannerStrategies,
} from './planner-strategies';
import { CONTROL_TABLE_NAMES } from './statement-builders';

export type { CallMigrationStrategy, StrategyContext };

// ============================================================================
// Issue kind ordering (dependency order)
// ============================================================================

const ISSUE_KIND_ORDER: Record<string, number> = {
  // Drops (reconciliation — clear the way for creates)
  extra_foreign_key: 10,
  extra_unique_constraint: 11,
  extra_primary_key: 12,
  extra_index: 13,
  extra_default: 14,
  extra_column: 15,
  extra_table: 16,

  // Tables before columns
  missing_table: 20,

  // Columns before constraints
  missing_column: 30,

  // Reconciliation alters (on existing objects)
  type_mismatch: 40,
  nullability_mismatch: 41,
  default_missing: 42,
  default_mismatch: 43,

  // Constraints after columns exist
  primary_key_mismatch: 50,
  unique_constraint_mismatch: 51,
  index_mismatch: 52,
  foreign_key_mismatch: 60,
};

function issueOrder(issue: SchemaIssue): number {
  return ISSUE_KIND_ORDER[issue.kind] ?? 99;
}

function issueKey(issue: SchemaIssue): string {
  const table = 'table' in issue && typeof issue.table === 'string' ? issue.table : '';
  const column = 'column' in issue && typeof issue.column === 'string' ? issue.column : '';
  const name =
    'indexOrConstraint' in issue && typeof issue.indexOrConstraint === 'string'
      ? issue.indexOrConstraint
      : '';
  return `${table}\u0000${column}\u0000${name}`;
}

// ============================================================================
// Conflict helpers
// ============================================================================

function issueConflict(
  kind: SqlPlannerConflict['kind'],
  summary: string,
  location?: SqlPlannerConflict['location'],
): SqlPlannerConflict {
  return {
    kind,
    summary,
    why: 'Use `migration new` to author a custom migration for this change.',
    ...(location ? { location } : {}),
  };
}

function conflictKindForIssue(issue: SchemaIssue): SqlPlannerConflict['kind'] {
  switch (issue.kind) {
    case 'type_mismatch':
      return 'typeMismatch';
    case 'nullability_mismatch':
      return 'nullabilityConflict';
    case 'primary_key_mismatch':
    case 'unique_constraint_mismatch':
    case 'index_mismatch':
    case 'extra_primary_key':
    case 'extra_unique_constraint':
      return 'indexIncompatible';
    case 'foreign_key_mismatch':
    case 'extra_foreign_key':
      return 'foreignKeyConflict';
    default:
      return 'missingButNonAdditive';
  }
}

function issueLocation(issue: SchemaIssue): SqlPlannerConflictLocation | undefined {
  if (issue.kind === 'enum_values_changed') return undefined;
  const location: {
    table?: string;
    column?: string;
    constraint?: string;
  } = {};
  if (issue.table) location.table = issue.table;
  if (issue.column) location.column = issue.column;
  if (issue.indexOrConstraint) location.constraint = issue.indexOrConstraint;
  return Object.keys(location).length > 0 ? (location as SqlPlannerConflictLocation) : undefined;
}

function conflictForDisallowedCall(
  call: SqliteOpFactoryCall,
  allowed: readonly string[],
): SqlPlannerConflict {
  const summary = `Operation "${call.label}" requires class "${call.operationClass}", but policy allows only: ${allowed.join(', ')}`;
  const location = locationForCall(call);
  return {
    kind: conflictKindForCall(call),
    summary,
    why: 'Use `migration new` to author a custom migration for this change.',
    ...(location ? { location } : {}),
  };
}

function conflictKindForCall(call: SqliteOpFactoryCall): SqlPlannerConflict['kind'] {
  switch (call.factoryName) {
    case 'createIndex':
    case 'dropIndex':
      return 'indexIncompatible';
    default:
      return 'missingButNonAdditive';
  }
}

function locationForCall(call: SqliteOpFactoryCall): SqlPlannerConflictLocation | undefined {
  const anyCall = call as unknown as {
    tableName?: string;
    columnName?: string;
    indexName?: string;
  };
  const location: { table?: string; column?: string; index?: string } = {};
  if (anyCall.tableName) location.table = anyCall.tableName;
  if (anyCall.columnName) location.column = anyCall.columnName;
  if (anyCall.indexName) location.index = anyCall.indexName;
  return Object.keys(location).length > 0 ? (location as SqlPlannerConflictLocation) : undefined;
}

function isMissing(issue: SchemaIssue): boolean {
  if (issue.kind === 'enum_values_changed') return false;
  return issue.actual === undefined;
}

// ============================================================================
// Issue planner
// ============================================================================

export interface IssuePlannerOptions {
  readonly issues: readonly SchemaIssue[];
  readonly toContract: Contract<SqlStorage>;
  readonly fromContract: Contract<SqlStorage> | null;
  readonly codecHooks: ReadonlyMap<string, CodecControlHooks>;
  readonly storageTypes: Readonly<Record<string, StorageTypeInstance>>;
  readonly schema?: SqlSchemaIR;
  readonly policy?: MigrationOperationPolicy;
  readonly frameworkComponents?: ReadonlyArray<TargetBoundComponentDescriptor<'sql', string>>;
  readonly strategies?: readonly CallMigrationStrategy[];
}

export interface IssuePlannerValue {
  readonly calls: readonly SqliteOpFactoryCall[];
}

const DEFAULT_POLICY: MigrationOperationPolicy = {
  allowedOperationClasses: ['additive', 'widening', 'destructive', 'data'],
};

function emptySchemaIR(): SqlSchemaIR {
  return { tables: {}, dependencies: [] };
}

// ============================================================================
// Issue → Call mapping (per-issue default path)
// ============================================================================

function mapIssueToCall(
  issue: SchemaIssue,
  ctx: StrategyContext,
): Result<readonly SqliteOpFactoryCall[], SqlPlannerConflict> {
  switch (issue.kind) {
    case 'missing_table': {
      if (!issue.table) {
        return notOk(
          issueConflict('unsupportedOperation', 'Missing table issue has no table name'),
        );
      }
      const contractTable = ctx.toContract.storage.tables[issue.table];
      if (!contractTable) {
        return notOk(
          issueConflict(
            'unsupportedOperation',
            `Table "${issue.table}" reported missing but not found in destination contract`,
          ),
        );
      }
      const codecHooks = ctx.codecHooks as Map<string, CodecControlHooks>;
      const storageTypes = ctx.storageTypes as Record<string, StorageTypeInstance>;
      const calls: SqliteOpFactoryCall[] = [
        new CreateTableCall(issue.table, contractTable, codecHooks, storageTypes),
      ];
      const declaredIndexColumnKeys = new Set<string>();
      for (const index of contractTable.indexes) {
        const indexName = index.name ?? defaultIndexName(issue.table, index.columns);
        declaredIndexColumnKeys.add(index.columns.join(','));
        calls.push(new CreateIndexCall(issue.table, indexName, index.columns));
      }
      for (const fk of contractTable.foreignKeys) {
        if (fk.index === false) continue;
        if (declaredIndexColumnKeys.has(fk.columns.join(','))) continue;
        const indexName = defaultIndexName(issue.table, fk.columns);
        calls.push(new CreateIndexCall(issue.table, indexName, fk.columns));
      }
      return ok(calls);
    }

    case 'missing_column': {
      if (!issue.table || !issue.column) {
        return notOk(
          issueConflict('unsupportedOperation', 'Missing column issue has no table/column name'),
        );
      }
      const column = ctx.toContract.storage.tables[issue.table]?.columns[issue.column];
      if (!column) {
        return notOk(
          issueConflict(
            'unsupportedOperation',
            `Column "${issue.table}"."${issue.column}" not in destination contract`,
          ),
        );
      }
      return ok([
        new AddColumnCall(
          issue.table,
          issue.column,
          column,
          ctx.codecHooks as Map<string, CodecControlHooks>,
          ctx.storageTypes as Record<string, StorageTypeInstance>,
        ),
      ]);
    }

    case 'index_mismatch': {
      if (!issue.table) {
        return notOk(issueConflict('indexIncompatible', 'Index issue has no table name'));
      }
      if (!isMissing(issue) || !issue.expected) {
        return notOk(
          issueConflict(
            'indexIncompatible',
            `Index on "${issue.table}" differs (expected: ${issue.expected}, actual: ${issue.actual})`,
            { table: issue.table },
          ),
        );
      }
      const columns = issue.expected.split(', ');
      const contractTable = ctx.toContract.storage.tables[issue.table];
      if (!contractTable) {
        return notOk(
          issueConflict(
            'unsupportedOperation',
            `Table "${issue.table}" not found in destination contract`,
          ),
        );
      }
      // Use the explicit-index name if one is declared for these columns;
      // otherwise fall back to `defaultIndexName` (which is also what
      // `verifySqlSchema` synthesizes for FK-backing indexes). Whether the
      // missing index originates from `contractTable.indexes` or from an FK
      // with `index: true` doesn't change the emitted DDL.
      const explicitIndex = contractTable.indexes.find(
        (idx) => idx.columns.join(',') === columns.join(','),
      );
      const indexName = explicitIndex?.name ?? defaultIndexName(issue.table, columns);
      return ok([new CreateIndexCall(issue.table, indexName, columns)]);
    }

    case 'extra_table': {
      if (!issue.table) {
        return notOk(issueConflict('unsupportedOperation', 'Extra table issue has no table name'));
      }
      // Runner-owned control tables must never be dropped.
      if (CONTROL_TABLE_NAMES.has(issue.table)) return ok([]);
      return ok([new DropTableCall(issue.table)]);
    }

    case 'extra_column': {
      if (!issue.table || !issue.column) {
        return notOk(
          issueConflict('unsupportedOperation', 'Extra column issue has no table/column name'),
        );
      }
      return ok([new DropColumnCall(issue.table, issue.column)]);
    }

    case 'extra_index': {
      if (!issue.table || !issue.indexOrConstraint) {
        return notOk(
          issueConflict('unsupportedOperation', 'Extra index issue has no table/index name'),
        );
      }
      return ok([new DropIndexCall(issue.table, issue.indexOrConstraint)]);
    }

    // Everything below is absorbed by recreateTableStrategy. If it falls
    // through here, policy or context didn't allow the recreate — surface as
    // a conflict.
    case 'type_mismatch':
    case 'nullability_mismatch':
    case 'default_mismatch':
    case 'default_missing':
    case 'extra_default':
    case 'primary_key_mismatch':
    case 'unique_constraint_mismatch':
    case 'foreign_key_mismatch':
    case 'extra_foreign_key':
    case 'extra_unique_constraint':
    case 'extra_primary_key':
      return notOk(issueConflict(conflictKindForIssue(issue), issue.message, issueLocation(issue)));

    default:
      return notOk(
        issueConflict(
          'unsupportedOperation',
          `Unhandled issue kind: ${(issue as SchemaIssue).kind}`,
        ),
      );
  }
}

// ============================================================================
// Call categorization for final emission order
// ============================================================================

type CallCategory =
  | 'drop-column'
  | 'drop-index'
  | 'drop-table'
  | 'create-table'
  | 'add-column'
  | 'create-index';

function classifyCall(call: SqliteOpFactoryCall): CallCategory | null {
  switch (call.factoryName) {
    case 'createTable':
      return 'create-table';
    case 'addColumn':
      return 'add-column';
    case 'createIndex':
      return 'create-index';
    case 'dropColumn':
      return 'drop-column';
    case 'dropIndex':
      return 'drop-index';
    case 'dropTable':
      return 'drop-table';
    // recreateTable goes into the recipe slot; return null for bucketable.
    case 'recreateTable':
      return null;
    default:
      return null;
  }
}

// ============================================================================
// Top-level planIssues
// ============================================================================

export function planIssues(
  options: IssuePlannerOptions,
): Result<IssuePlannerValue, readonly SqlPlannerConflict[]> {
  const policyProvided = options.policy !== undefined;
  const policy = options.policy ?? DEFAULT_POLICY;
  const schema = options.schema ?? emptySchemaIR();
  const frameworkComponents = options.frameworkComponents ?? [];

  const context: StrategyContext = {
    toContract: options.toContract,
    fromContract: options.fromContract,
    codecHooks: options.codecHooks,
    storageTypes: options.storageTypes,
    schema,
    policy,
    frameworkComponents,
  };

  const strategies = options.strategies ?? sqlitePlannerStrategies;

  let remaining = options.issues;
  const recipeCalls: SqliteOpFactoryCall[] = [];
  const bucketableCalls: SqliteOpFactoryCall[] = [];

  for (const strategy of strategies) {
    const result = strategy(remaining, context);
    if (result.kind === 'match') {
      remaining = result.issues;
      if (result.recipe) {
        recipeCalls.push(...result.calls);
      } else {
        bucketableCalls.push(...result.calls);
      }
    }
  }

  const sorted = [...remaining].sort((a, b) => {
    const kindDelta = issueOrder(a) - issueOrder(b);
    if (kindDelta !== 0) return kindDelta;
    const keyA = issueKey(a);
    const keyB = issueKey(b);
    return keyA < keyB ? -1 : keyA > keyB ? 1 : 0;
  });

  const defaultCalls: SqliteOpFactoryCall[] = [];
  const conflicts: SqlPlannerConflict[] = [];

  for (const issue of sorted) {
    const result = mapIssueToCall(issue, context);
    if (result.ok) {
      defaultCalls.push(...result.value);
    } else {
      conflicts.push(result.failure);
    }
  }

  // Policy gating for recipe + bucketable. Default-mapped calls for disallowed
  // classes never get here (they're surfaced as per-issue conflicts above).
  const allowed = policy.allowedOperationClasses;
  let gatedRecipe = recipeCalls;
  let gatedBucketable = bucketableCalls;
  let gatedDefault = defaultCalls;
  if (policyProvided) {
    const sink = (acc: SqliteOpFactoryCall[]) => (call: SqliteOpFactoryCall) => {
      if (allowed.includes(call.operationClass)) {
        acc.push(call);
        return;
      }
      conflicts.push(conflictForDisallowedCall(call, allowed));
    };
    const gatedRecipeBucket: SqliteOpFactoryCall[] = [];
    const gatedBucketableBucket: SqliteOpFactoryCall[] = [];
    const gatedDefaultBucket: SqliteOpFactoryCall[] = [];
    recipeCalls.forEach(sink(gatedRecipeBucket));
    bucketableCalls.forEach(sink(gatedBucketableBucket));
    defaultCalls.forEach(sink(gatedDefaultBucket));
    gatedRecipe = gatedRecipeBucket;
    gatedBucketable = gatedBucketableBucket;
    gatedDefault = gatedDefaultBucket;
  }

  if (conflicts.length > 0) {
    return notOk(conflicts);
  }

  // Final emission order matches the current monolithic planner:
  //   create-table → add-column → create-index → recreate → drop-column → drop-index → drop-table
  const combined = [...gatedDefault, ...gatedBucketable];
  const byCategory = (cat: CallCategory) => combined.filter((c) => classifyCall(c) === cat);

  const calls: SqliteOpFactoryCall[] = [
    ...byCategory('create-table'),
    ...byCategory('add-column'),
    ...byCategory('create-index'),
    ...gatedRecipe,
    ...byCategory('drop-column'),
    ...byCategory('drop-index'),
    ...byCategory('drop-table'),
  ];

  return ok({ calls });
}
