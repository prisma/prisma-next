import type { TargetFamilyContext } from '@prisma-next/core-control-plane/types';
import type { SqlCodecRegistry } from '@prisma-next/sql-contract/types';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';

/**
 * SQL family context that binds together schema IR and codec registry.
 * This is the SQL family's instantiation of TargetFamilyContext.
 */
export type SqlFamilyContext = TargetFamilyContext<SqlSchemaIR, SqlCodecRegistry>;
