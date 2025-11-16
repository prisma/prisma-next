import type { TargetFamilyContext } from '@prisma-next/core-control-plane/types';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import type { SqlTypeMetadataRegistry } from './types';

/**
 * SQL family context that binds together schema IR and type metadata registry.
 * This is the SQL family's instantiation of TargetFamilyContext, adding SQL-specific control-plane state.
 */
export type SqlFamilyContext = TargetFamilyContext<SqlSchemaIR> & {
  readonly types: SqlTypeMetadataRegistry;
};
