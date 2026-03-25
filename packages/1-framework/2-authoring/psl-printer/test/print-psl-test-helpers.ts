import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import { createPostgresDefaultMapping } from '../src/postgres-default-mapping';
import { createPostgresTypeMap, extractEnumTypeNames } from '../src/postgres-type-map';

export function makeOptions(schemaIR: SqlSchemaIR) {
  const enumTypeNames = extractEnumTypeNames(schemaIR.annotations);
  return {
    defaultMapping: createPostgresDefaultMapping(),
    typeMap: createPostgresTypeMap(enumTypeNames),
  };
}
