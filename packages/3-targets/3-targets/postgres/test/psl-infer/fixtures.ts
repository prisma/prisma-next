import type { PslDocumentAst } from '@prisma-next/framework-components/psl-ast';
import { printPsl } from '@prisma-next/psl-printer';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import { postgresAuthoringPslBlockDescriptors } from '../../src/core/authoring';
import { inferPostgresPslContract } from '../../src/core/psl-infer/infer-psl-contract';
import { PostgresDatabaseSchemaNode } from '../../src/core/schema-ir/postgres-database-schema-node';
import type { PostgresNativeEnumIntrospection } from '../../src/core/schema-ir/postgres-namespace-schema-node';
import { PostgresNamespaceSchemaNode } from '../../src/core/schema-ir/postgres-namespace-schema-node';
import { PostgresTableSchemaNode } from '../../src/core/schema-ir/postgres-table-schema-node';

/**
 * Wraps a flat `{ tables, annotations? }` introspection fixture into the
 * `PostgresDatabaseSchemaNode` tree the target's inference walks. The flat
 * `annotations.pg.nativeEnums` (`{ typeName, values }` entries) becomes the
 * namespace's `nativeEnums`, with `nativeEnumTypeNames` derived from it unless
 * `annotations.pg.nativeEnumTypeNames` is given explicitly. All fixture tables
 * live under the single `public` namespace (`contract infer` introspects one
 * live schema).
 */
export function treeFromFlat(schemaIR: SqlSchemaIR): PostgresDatabaseSchemaNode {
  const nativeEnums = readNativeEnums(schemaIR.annotations);
  const explicitTypeNames = readNativeEnumTypeNames(schemaIR.annotations);
  const nativeEnumTypeNames =
    explicitTypeNames.length > 0 ? explicitTypeNames : nativeEnums.map((e) => e.typeName);
  const tables: Record<string, PostgresTableSchemaNode> = {};
  for (const [name, table] of Object.entries(schemaIR.tables)) {
    tables[name] = new PostgresTableSchemaNode(table);
  }
  return new PostgresDatabaseSchemaNode({
    namespaces: {
      public: new PostgresNamespaceSchemaNode({
        schemaName: 'public',
        tables,
        nativeEnumTypeNames,
        nativeEnums,
      }),
    },
    roles: [],
    existingSchemas: ['public'],
    pgVersion: '',
  });
}

/** Infers and prints PSL from a flat introspection fixture. */
export function printPslFromFlat(schemaIR: SqlSchemaIR): string {
  return printPsl(inferPostgresPslContract(treeFromFlat(schemaIR)), {
    pslBlockDescriptors: postgresAuthoringPslBlockDescriptors,
  });
}

/** Infers a PSL AST from a flat introspection fixture. */
export function inferPslAstFromFlat(schemaIR: SqlSchemaIR): PslDocumentAst {
  return inferPostgresPslContract(treeFromFlat(schemaIR));
}

function readPgAnnotationArray(
  annotations: SqlSchemaIR['annotations'],
  key: string,
): unknown[] | undefined {
  const pg = annotations?.['pg'];
  const value = pg && typeof pg === 'object' ? (pg as Record<string, unknown>)[key] : undefined;
  return Array.isArray(value) ? value : undefined;
}

function readNativeEnumTypeNames(annotations: SqlSchemaIR['annotations']): readonly string[] {
  const names = readPgAnnotationArray(annotations, 'nativeEnumTypeNames') ?? [];
  return names.filter((name): name is string => typeof name === 'string');
}

function readNativeEnums(
  annotations: SqlSchemaIR['annotations'],
): readonly PostgresNativeEnumIntrospection[] {
  const entries = readPgAnnotationArray(annotations, 'nativeEnums') ?? [];
  return entries.filter(
    (entry): entry is PostgresNativeEnumIntrospection =>
      typeof entry === 'object' &&
      entry !== null &&
      typeof (entry as { typeName?: unknown }).typeName === 'string' &&
      Array.isArray((entry as { values?: unknown }).values),
  );
}
