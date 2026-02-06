import type { SqlControlExtensionDescriptor } from '@prisma-next/family-sql/control';
import { sqliteVectorPackMeta } from '../core/descriptor-meta';

/**
 * sqlite-vector extension descriptor for CLI config.
 *
 * Note: SQLite "extensions" in Prisma Next are purely logical packs. This pack
 * lowers cosine distance to pure SQL (JSON1 + math functions), so no database-side
 * extension install or JS UDF registration is required.
 */
const sqliteVectorExtensionDescriptor: SqlControlExtensionDescriptor<'sqlite'> = {
  ...sqliteVectorPackMeta,
  create: () => ({
    familyId: 'sql' as const,
    targetId: 'sqlite' as const,
  }),
};

export { sqliteVectorExtensionDescriptor };
export default sqliteVectorExtensionDescriptor;
