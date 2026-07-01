import type { ColumnDefault, Contract } from '@prisma-next/contract/types';
import { contractToSchemaIR } from '@prisma-next/family-sql/control';
import { verifySqlSchemaTree } from '@prisma-next/family-sql/diff';
import type { TargetBoundComponentDescriptor } from '@prisma-next/framework-components/components';
import type { VerifyDatabaseSchemaResult } from '@prisma-next/framework-components/control';
import type { SqlStorage, StorageColumn } from '@prisma-next/sql-contract/types';
import type { SqlSchemaIR, SqlSchemaIRNode } from '@prisma-next/sql-schema-ir/types';
import { parseSqliteDefault } from '../default-normalizer';
import { normalizeSqliteNativeType } from '../native-type-normalizer';
import { renderDefaultLiteral } from './planner-ddl-builders';

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

/**
 * The SQLite combined database-schema diff — relational only. SQLite has a
 * single flat schema and no structural (policy) diff, so it runs the shared
 * per-schema relational diff and returns no `schemaDiffIssues`.
 */
export function diffSqliteDatabaseSchema(input: {
  readonly contract: Contract<SqlStorage>;
  readonly actualSchema: SqlSchemaIRNode;
  readonly strict: boolean;
  readonly typeMetadataRegistry: ReadonlyMap<string, { readonly nativeType?: string }>;
  readonly frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<'sql', string>>;
}): VerifyDatabaseSchemaResult {
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
