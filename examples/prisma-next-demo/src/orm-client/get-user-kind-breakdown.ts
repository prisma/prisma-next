import type { DefaultModelRow } from '@prisma-next/sql-orm-client';
import type { Runtime } from '@prisma-next/sql-runtime';
import type { Contract } from '../prisma/contract.d';
import { createOrmClient } from './client';

type UserKind = DefaultModelRow<Contract, 'User'>['kind'];

export async function ormClientGetUserKindBreakdown(
  minUsers: number,
  runtime: Runtime,
): Promise<Array<{ kind: UserKind; totalUsers: number }>> {
  const db = createOrmClient(runtime);
  const grouped = await db.users
    .groupBy('kind')
    .having((having) => having.count().gte(minUsers))
    .aggregate((aggregate) => ({
      totalUsers: aggregate.count(),
    }));

  return [...grouped].sort((left, right) => left.kind.localeCompare(right.kind));
}
