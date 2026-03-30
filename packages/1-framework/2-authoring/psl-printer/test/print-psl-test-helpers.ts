import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import { createPostgresDefaultMapping } from '../src/postgres-default-mapping';
import { createPostgresTypeMap, extractEnumInfo } from '../src/postgres-type-map';
import { parseRawDefault } from '../src/raw-default-parser';

export function makeOptions(schemaIR: SqlSchemaIR) {
  const enumInfo = extractEnumInfo(schemaIR.annotations);
  return {
    defaultMapping: createPostgresDefaultMapping(),
    typeMap: createPostgresTypeMap(enumInfo.typeNames),
    enumInfo,
    parseRawDefault,
  };
}
