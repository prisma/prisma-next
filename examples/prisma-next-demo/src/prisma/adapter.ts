import { createPostgresAdapter } from '@prisma-next/adapter-postgres/adapter';
import type {
  PostgresContract,
  PostgresLoweredStatement,
} from '@prisma-next/adapter-postgres/types';
import type { Adapter, SelectAst } from '@prisma-next/sql-relational-core/ast';

export const adapter: Adapter<SelectAst, PostgresContract, PostgresLoweredStatement> =
  Object.freeze(createPostgresAdapter());
