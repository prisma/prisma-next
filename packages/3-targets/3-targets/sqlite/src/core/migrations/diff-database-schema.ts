import type { ColumnDefault, Contract } from '@prisma-next/contract/types';
import type { SqlSchemaDiffForVerdict } from '@prisma-next/family-sql/control';
import { buildNativeTypeExpander, contractToSchemaIR } from '@prisma-next/family-sql/control';
import {
  neutralizeFlatExpectedFkSchemas,
  normalizeFlatActualForDiff,
  verifySqlSchemaTree,
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

/** The SQLite expected-side projection: contract → flat relational schema IR. */
export function sqliteContractToSchema(contract: Contract<SqlStorage> | null): SqlSchemaIR {
  return contractToSchemaIR(contract, {
    annotationNamespace: 'sqlite',
    renderDefault: sqliteRenderDefault,
  });
}

function computeSqliteSchemaComparison(
  input: SqliteDiffDatabaseSchemaInput,
): VerifyDatabaseSchemaResult {
  return verifySqlSchemaTree({
    contract: input.contract,
    actualSchema: input.actualSchema,
    buildExpectedSchema: sqliteContractToSchema,
    strict: input.strict,
    typeMetadataRegistry: input.typeMetadataRegistry,
    frameworkComponents: input.frameworkComponents,
    normalizeDefault: parseSqliteDefault,
    normalizeNativeType: normalizeSqliteNativeType,
  });
}

/**
 * The SQLite `SchemaDiffer` — relational only. SQLite has a single flat
 * schema and no structural (policy) diff, so it runs the shared per-schema
 * relational diff and returns no `schemaDiffIssues`.
 */
export function diffSqliteDatabaseSchema(input: SqliteDiffDatabaseSchemaInput): SchemaDiff {
  const relational = computeSqliteSchemaComparison(input);
  return new SchemaDiff(relational.schema.issues, relational.schema.schemaDiffIssues);
}

/**
 * The same comparison as {@link diffSqliteDatabaseSchema}, wrapped in the
 * verify envelope (`ok`/`summary`/`code`/`target`/`timings`) plus the
 * pass/warn/fail tree the CLI renders.
 */
export function verifySqliteDatabaseSchema(
  input: SqliteDiffDatabaseSchemaInput,
): VerifyDatabaseSchemaResult {
  return computeSqliteSchemaComparison(input);
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
