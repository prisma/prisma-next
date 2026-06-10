import { orm, type RuntimeQueryable } from '@prisma-next/sql-orm-client';
import type { ExecutionContext } from '@prisma-next/sql-relational-core/query-lane-context';
import type { Contract } from '../prisma/contract.d';
import { db } from '../prisma/db';
import { PostCollection, UserCollection } from './collections';

const context: ExecutionContext<Contract> = db.context;

export function createOrmClient(runtime: RuntimeQueryable) {
  return orm({
    runtime,
    context,
    collections: {
      User: UserCollection,
      Post: PostCollection,
    },
  }).public;
}
