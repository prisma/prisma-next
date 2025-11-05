import { createPostgresAdapter } from '@prisma-next/adapter-postgres/adapter';
import type { Adapter } from '@prisma-next/sql-target';
import type { SelectAst } from '@prisma-next/sql/types';
import type { PostgresContract, PostgresLoweredStatement } from '@prisma-next/adapter-postgres/types';

export const adapter: Adapter<SelectAst, PostgresContract, PostgresLoweredStatement> = Object.freeze(createPostgresAdapter());
