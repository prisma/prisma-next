import { sql } from '@prisma-next/sql/sql';
import { schema } from '@prisma-next/sql/schema';
import { param } from '@prisma-next/sql/param';
import { createPostgresAdapter } from '@prisma-next/adapter-postgres/adapter';
import { getRuntime } from '../prisma/runtime';
import type { Contract } from '../prisma/contract.d';
import contractJson from '../prisma/contract.json' assert { type: 'json' };
import { validateContract } from '@prisma-next/sql/schema';
import type { ResultType } from '@prisma-next/sql/types';

const contract = validateContract<Contract>(contractJson);
const adapter = createPostgresAdapter();

export async function getUserPosts(userId: number) {
  const runtime = getRuntime();
  const tables = schema(contract).tables;
  const postTable = tables['post']!;

  const plan = sql({ contract, adapter })
    .from(postTable)
    .where(postTable.columns['userId']!.eq(param('userId')))
    .select({
      id: postTable.columns['id']!,
      title: postTable.columns['title']!,
      userId: postTable.columns['userId']!,
      createdAt: postTable.columns['createdAt']!,
    })
    .build({ params: { userId } });

  // Result type: Array<{ id: number; title: string; userId: number; createdAt: string }>
  type Row = ResultType<typeof plan>;
  const rows: Row[] = [];

  for await (const row of runtime.execute(plan)) {
    rows.push(row);
  }

  return rows;
}

