import type { PslDocumentAst } from '@prisma-next/framework-components/psl-ast';
import { printPsl } from '@prisma-next/psl-printer';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import { inferPostgresPslContract } from '../../src/core/psl-infer/infer-psl-contract';
import { PostgresDatabaseSchemaNode } from '../../src/core/schema-ir/postgres-database-schema-node';
import { PostgresNamespaceSchemaNode } from '../../src/core/schema-ir/postgres-namespace-schema-node';
import { PostgresTableSchemaNode } from '../../src/core/schema-ir/postgres-table-schema-node';

/**
 * Wraps a flat `{ tables, annotations? }` introspection fixture into the
 * `PostgresDatabaseSchemaNode` tree the target's inference walks. The old flat
 * `annotations.pg.nativeEnumTypeNames` becomes the namespace's typed
 * `nativeEnumTypeNames`. All fixture tables live under the single `public`
 * namespace (`contract infer` introspects one live schema), so the inferred PSL
 * is byte-identical to the prior flat inference.
 */
export function treeFromFlat(schemaIR: SqlSchemaIR): PostgresDatabaseSchemaNode {
  const nativeEnumTypeNames = readNativeEnumTypeNames(schemaIR.annotations);
  const tables: Record<string, PostgresTableSchemaNode> = {};
  for (const [name, table] of Object.entries(schemaIR.tables)) {
    tables[name] = new PostgresTableSchemaNode({
      name: table.name,
      columns: table.columns,
      foreignKeys: table.foreignKeys,
      uniques: table.uniques,
      indexes: table.indexes,
      ...(table.primaryKey !== undefined ? { primaryKey: table.primaryKey } : {}),
      ...(table.annotations !== undefined ? { annotations: table.annotations } : {}),
      ...(table.checks !== undefined ? { checks: table.checks } : {}),
      rlsEnabled: false,
    });
  }
  return new PostgresDatabaseSchemaNode({
    namespaces: {
      public: new PostgresNamespaceSchemaNode({
        schemaName: 'public',
        tables,
        nativeEnumTypeNames,
      }),
    },
    roles: [],
    existingSchemas: ['public'],
    pgVersion: '',
  });
}

/** Infers and prints PSL from a flat introspection fixture. */
export function printPslFromFlat(schemaIR: SqlSchemaIR): string {
  return printPsl(inferPostgresPslContract(treeFromFlat(schemaIR)));
}

/** Infers a PSL AST from a flat introspection fixture. */
export function inferPslAstFromFlat(schemaIR: SqlSchemaIR): PslDocumentAst {
  return inferPostgresPslContract(treeFromFlat(schemaIR));
}

function readNativeEnumTypeNames(annotations: SqlSchemaIR['annotations']): readonly string[] {
  const pg = annotations?.['pg'];
  const names =
    pg && typeof pg === 'object'
      ? (pg as Record<string, unknown>)['nativeEnumTypeNames']
      : undefined;
  if (!Array.isArray(names)) return [];
  return names.filter((name): name is string => typeof name === 'string');
}
