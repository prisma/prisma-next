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
import type { VerifyDatabaseSchemaResult } from '@prisma-next/framework-components/control';
import { diffSchemas, SchemaDiff } from '@prisma-next/framework-components/control';
import type { SqlStorage, StorageColumn } from '@prisma-next/sql-contract/types';
import type { SqlSchemaIRNode } from '@prisma-next/sql-schema-ir/types';
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
      sqliteContractToSchema(scoped, { expandNativeType, renderColumnOps }),
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
