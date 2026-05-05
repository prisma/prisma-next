import { orm } from '@prisma-next/sql-orm-client';
import type { ExecutionContext } from '@prisma-next/sql-relational-core/query-lane-context';
import type { Runtime } from '@prisma-next/sql-runtime';
import type { Contract } from './contract';
import { db } from './db';

const context = db.context as ExecutionContext<Contract>;

export function createOrmClient(runtime: Runtime) {
  return orm<Contract>({ runtime, context });
}

export type OrmClient = ReturnType<typeof createOrmClient>;
