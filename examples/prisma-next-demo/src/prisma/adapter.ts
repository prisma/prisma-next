import { createPostgresAdapter } from '@prisma-next/adapter-postgres/adapter';
import type {
  PostgresContract,
  PostgresLoweredStatement,
} from '@prisma-next/adapter-postgres/types';
import type { SelectAst } from '@prisma-next/sql-target';
import type { Adapter } from '@prisma-next/sql-target';

export const adapter: Adapter<SelectAst, PostgresContract, PostgresLoweredStatement> =
  Object.freeze(createPostgresAdapter());
