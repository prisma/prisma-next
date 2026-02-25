import type { Runtime } from '@prisma-next/sql-runtime';
import { createOrmClient } from './client';

export async function ormClientAggregateUsers(runtime: Runtime) {
  const db = createOrmClient(runtime);
  const totalUsers = await db.users.aggregate((aggregate) => ({
    totalUsers: aggregate.count(),
  }));
  const adminUsers = await db.users.where({ kind: 'admin' }).aggregate((aggregate) => ({
    adminUsers: aggregate.count(),
  }));

  return {
    ...totalUsers,
    ...adminUsers,
  };
}
