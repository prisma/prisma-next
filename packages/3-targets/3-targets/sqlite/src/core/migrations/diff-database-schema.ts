import type { ColumnDefault, Contract } from '@prisma-next/contract/types';
import type {
  ColumnOpRenderer,
  NativeTypeExpander,
  SqlSchemaDiffForVerdict,
} from '@prisma-next/family-sql/control';
import { buildNativeTypeExpander, contractToSchemaIR } from '@prisma-next/family-sql/control';
import {
  collectSqlSchemaIssuesPerNamespace,
  neutralizeFlatExpectedFkSchemas,
  normalizeFlatActualForDiff,
  verifySqlSchemaByDiff,
} from '@prisma-next/family-sql/diff';
import type { TargetBoundComponentDescriptor } from '@prisma-next/framework-components/components';
import type {
  SchemaDiffIssue,
  VerifyDatabaseSchemaResult,
} from '@prisma-next/framework-components/control';
import { diffSchemas, SchemaDiff } from '@prisma-next/framework-components/control';
import type { SqlStorage, StorageColumn } from '@prisma-next/sql-contract/types';
import type {
  SqlColumnIRInput,
  SqlSchemaIRInput,
  SqlSchemaIRNode,
  SqlTableIRInput,
} from '@prisma-next/sql-schema-ir/types';
import { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import { blindCast } from '@prisma-next/utils/casts';
import { ifDefined } from '@prisma-next/utils/defined';
import { parseSqliteDefault } from '../default-normalizer';
import { normalizeSqliteNativeType } from '../native-type-normalizer';
import { renderDefaultLiteral } from './planner-ddl-builders';
import { buildSqliteColumnOpRender } from './sqlite-column-op-render';

interface SqliteDiffDatabaseSchemaInput {
  readonly contract: Contract<SqlStorage>;
  readonly actualSchema: SqlSchemaIRNode;
  readonly strict: boolean;
  readonly typeMetadataRegistry: ReadonlyMap<string, { readonly nativeType?: string }>;
  readonly frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<'sql', string>>;
}

/** Renders a column default for the SQLite dialect. */
export function sqliteRenderDefault(def: ColumnDefault, _column: StorageColumn): string {
  if (def.kind === 'function') {
    if (def.expression === 'now()') {
      return "datetime('now')";
    }
    return def.expression;
  }
  return renderDefaultLiteral(def.value);
}

/**
 * The SQLite expected-side projection: contract → flat relational schema IR.
 *
 * `extras` thread the plan-time derivation inputs: the native-type expander
 * (so the expected side carries resolved native types, like the verify side)
 * and the op-render stamper (so expected column nodes carry the SQLite DDL
 * payload the planner reads). Verify-only callers omit them.
 */
export function sqliteContractToSchema(
  contract: Contract<SqlStorage> | null,
  extras?: {
    readonly expandNativeType?: NativeTypeExpander;
    readonly renderColumnOps?: ColumnOpRenderer;
  },
): SqlSchemaIR {
  return contractToSchemaIR(contract, {
    annotationNamespace: 'sqlite',
    renderDefault: sqliteRenderDefault,
    ...ifDefined('expandNativeType', extras?.expandNativeType),
    ...ifDefined('renderColumnOps', extras?.renderColumnOps),
  });
}

/**
 * The SQLite `SchemaDiffer` — relational only, the migration planner's diff
 * input. SQLite has a single flat schema and no structural (policy) diff, so
 * it runs the shared per-namespace relational issue diff and returns no
 * `schemaDiffIssues`. Retires when the planner takes `plan(start, end)`.
 */
export function diffSqliteDatabaseSchema(input: SqliteDiffDatabaseSchemaInput): SchemaDiff {
  const expandNativeType = buildNativeTypeExpander(input.frameworkComponents);
  const storageTypes = input.contract.storage.types ?? {};
  const renderColumnOps: ColumnOpRenderer = (name, column, table) =>
    buildSqliteColumnOpRender(name, column, table, storageTypes);
  const issues = collectSqlSchemaIssuesPerNamespace({
    contract: input.contract,
    actualSchema: input.actualSchema,
    buildExpectedSchema: (scoped) =>
      sqliteContractToSchema(scoped, {
        ...ifDefined('expandNativeType', expandNativeType),
        renderColumnOps,
      }),
    strict: input.strict,
    frameworkComponents: input.frameworkComponents,
    normalizeDefault: parseSqliteDefault,
    normalizeNativeType: normalizeSqliteNativeType,
  });
  return new SchemaDiff(issues, []);
}

/**
 * The SQLite schema verify: the full-tree node-diff verdict wrapped in the
 * issue-based result envelope. Used by the runner's post-apply check; the
 * family `verifySchema` runs the same composition via the descriptor hook.
 */
export function verifySqliteDatabaseSchema(
  input: SqliteDiffDatabaseSchemaInput,
): VerifyDatabaseSchemaResult {
  return verifySqlSchemaByDiff({
    contract: input.contract,
    schema: input.actualSchema,
    strict: input.strict,
    frameworkComponents: input.frameworkComponents,
    diffSchemaForVerdict: diffSqliteSchemaForVerdict,
  });
}

/**
 * The SQLite full-tree node diff for the family verify verdict: derive the
 * expected flat tree with resolved leaf values (expander threaded so
 * parameterized types compare expanded), neutralize the FK schema segment
 * (single-schema target — introspection stamps none), normalize the actual
 * tree for semantic satisfaction, and run the generic differ. Flat targets
 * need no ownership scoping. The codec `verifyType` hooks run once per
 * contract namespace with tables, each against the sole flat actual root —
 * exactly the legacy per-namespace pairing.
 */
export function diffSqliteSchemaForVerdict(input: {
  readonly contract: Contract<SqlStorage>;
  readonly schema: SqlSchemaIRNode;
  readonly frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<'sql', string>>;
}): SqlSchemaDiffForVerdict {
  const expandNativeType = buildNativeTypeExpander(input.frameworkComponents);
  const expected = neutralizeFlatExpectedFkSchemas(
    contractToSchemaIR(input.contract, {
      annotationNamespace: 'sqlite',
      renderDefault: sqliteRenderDefault,
      ...ifDefined('expandNativeType', expandNativeType),
    }),
  );
  const actual =
    input.schema instanceof SqlSchemaIR
      ? input.schema
      : blindCast<
          SqlSchemaIR,
          'the SQLite introspection adapter always produces a flat SqlSchemaIR root'
        >(input.schema);
  const normalizedActual = normalizeFlatActualForDiff(expected, actual);
  const issues = diffSchemas(expected, normalizedActual);
  const namespacesWithTables = Object.values(input.contract.storage.namespaces).filter(
    (ns) => Object.keys(ns.entries.table ?? {}).length > 0,
  );
  return {
    issues,
    expectedRoot: expected,
    namespacePairs: namespacesWithTables.map(() => ({ actual })),
  };
}

export interface SqlitePlanDiff {
  /** The desired ("end") tree — resolved leaf values, `opRender` stamped on every column. */
  readonly expected: SqlSchemaIR;
  /** The live ("start") tree, normalized for semantic satisfaction against `expected`. */
  readonly actual: SqlSchemaIR;
  readonly issues: readonly SchemaDiffIssue[];
}

/**
 * The SQLite planner's diff input: the same tree-building
 * `diffSqliteSchemaForVerdict` uses (expander threaded, FK schema segment
 * neutralized, actual tree normalized for semantic satisfaction), plus the
 * op-render stamper so expected column nodes carry the DDL payload the
 * planner's op-builders read. One differ drives both verify and plan; this
 * is the plan-side derivation (verify never needs `renderColumnOps`).
 */
export function buildSqlitePlanDiff(input: {
  readonly contract: Contract<SqlStorage>;
  readonly actualSchema: SqlSchemaIRNode;
  readonly frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<'sql', string>>;
}): SqlitePlanDiff {
  const expandNativeType = buildNativeTypeExpander(input.frameworkComponents);
  const storageTypes = input.contract.storage.types ?? {};
  const renderColumnOps: ColumnOpRenderer = (name, column, table) =>
    buildSqliteColumnOpRender(name, column, table, storageTypes);
  const expected = neutralizeFlatExpectedFkSchemas(
    sqliteContractToSchema(input.contract, {
      ...ifDefined('expandNativeType', expandNativeType),
      renderColumnOps,
    }),
  );
  // The differ dispatches polymorphically (`.isEqualTo()` / `.children()`), so
  // the actual tree must be genuine `SqlSchemaIR`/`SqlTableIR`/`SqlColumnIR`
  // instances, not plain data shaped like them. `new SqlSchemaIR(...)`
  // normalizes either input uniformly (an already-real tree passes through
  // untouched — its nested values are already instances) and is a no-op
  // rebuild in the common (real-instance) case, so this is always safe to run.
  const actualRaw = new SqlSchemaIR(withRecordKeyNames(input.actualSchema));
  const actual = normalizeFlatActualForDiff(expected, actualRaw);
  const issues = diffSchemas(expected, actual);
  return { expected, actual, issues };
}

/**
 * Every schema-tree builder in this codebase derives a table's / column's
 * `name` from the record key it's stored under (`contractToSchemaIR`,
 * the SQLite introspection adapter) rather than trusting a redundant
 * embedded field — the record key IS the identity. Mirrors that discipline
 * for the actual/live tree before construction, so `SqlTableIR.id` /
 * `SqlColumnIR.id` (both derived from `.name`) are always correct without
 * requiring every caller to duplicate the key onto the value. A no-op for a
 * tree that already carries matching names (the real introspection adapter
 * always does).
 */
function withRecordKeyNames(actualSchema: SqlSchemaIRNode): SqlSchemaIRInput {
  const raw = blindCast<
    { readonly tables?: Readonly<Record<string, unknown>> },
    'the SQLite introspection adapter always produces a flat, tables-keyed root'
  >(actualSchema);
  const tables: Record<string, SqlTableIRInput> = {};
  for (const [tableName, table] of Object.entries(raw.tables ?? {})) {
    const rawTable = blindCast<
      Omit<SqlTableIRInput, 'name' | 'columns'>,
      'every table value in a tables record is SqlTableIR(Input)-shaped'
    >(table);
    const columns: Record<string, SqlColumnIRInput> = {};
    for (const [columnName, column] of Object.entries(
      blindCast<
        { readonly columns?: Readonly<Record<string, unknown>> },
        'every SqlTableIR(Input) carries a columns record keyed by column name'
      >(table).columns ?? {},
    )) {
      columns[columnName] = {
        ...blindCast<
          SqlColumnIRInput,
          'every column value in a columns record is SqlColumnIR(Input)-shaped'
        >(column),
        name: columnName,
      };
    }
    tables[tableName] = {
      ...rawTable,
      name: tableName,
      columns,
      foreignKeys: rawTable.foreignKeys ?? [],
      uniques: rawTable.uniques ?? [],
      indexes: rawTable.indexes ?? [],
    };
  }
  return { tables };
}
