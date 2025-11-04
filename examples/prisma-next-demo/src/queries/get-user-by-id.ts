import { sql } from '@prisma-next/sql/sql';
import { schema } from '@prisma-next/sql/schema';
import { param } from '@prisma-next/sql/param';
import { createPostgresAdapter } from '@prisma-next/adapter-postgres/adapter';
import { getRuntime } from '../prisma/runtime';
import type { Contract, CodecTypes } from '../prisma/contract.d';
import contractJson from '../prisma/contract.json' assert { type: 'json' };
import { validateContract } from '@prisma-next/sql/schema';
import type { ResultType } from '@prisma-next/sql/types';

const contract = validateContract<Contract>(contractJson);
const adapter = createPostgresAdapter();

export async function getUserById(userId: number) {
  const runtime = getRuntime();
  const tables = schema<Contract, CodecTypes>(contract).tables;
  const userTable = tables['user']!;

  const plan = sql<Contract, CodecTypes>({ contract, adapter })
    .from(userTable)
    .where(userTable.columns['id']!.eq(param('userId')))
    .select({
      id: userTable.columns['id']!,
      email: userTable.columns['email']!,
      createdAt: userTable.columns['createdAt']!,
    })
    .limit(1)
    .build({ params: { userId } });

  // Result type: Array<{ id: number; email: string; createdAt: string }>
  type Row = ResultType<typeof plan>;
  const rows: Row[] = [];

  for await (const row of runtime.execute(plan)) {
    rows.push(row);
  }

  return rows[0] ?? null;
}
