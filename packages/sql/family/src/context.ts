import type { TargetFamilyContext } from '@prisma-next/core-control-plane/types';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import type { SqlTypeMetadataRegistry } from './types';

/**
 * SQL family context that carries the schema IR type and SQL-specific control-plane state.
 * This is the SQL family's instantiation of TargetFamilyContext, adding SQL-specific control-plane state.
 *
 * The context does not contain schemaIR as a runtime field; it only carries the type.
 * The schemaIR itself is produced by introspection and passed as a separate value.
 */
export type SqlFamilyContext = TargetFamilyContext<SqlSchemaIR> & {
  readonly types: SqlTypeMetadataRegistry;
};
