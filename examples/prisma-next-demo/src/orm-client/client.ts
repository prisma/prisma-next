import { orm } from '@prisma-next/sql-orm-client';
import type { ExecutionContext } from '@prisma-next/sql-relational-core/query-lane-context';
import type { Runtime } from '@prisma-next/sql-runtime';
import type { Contract } from '../prisma/contract.d';
import { db } from '../prisma/db';
import { PostCollection, TaskCollection, UserCollection } from './collections';

const context = db.context as ExecutionContext<Contract>;

export function createOrmClient(runtime: Runtime) {
  return orm({
    runtime,
    context,
    collections: {
      User: UserCollection,
      Post: PostCollection,
      Task: TaskCollection,
    },
  });
}
