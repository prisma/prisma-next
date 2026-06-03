import type { DefaultModelRow } from '@prisma-next/sql-orm-client';
import type { Runtime } from '@prisma-next/sql-runtime';
import { castAs } from '@prisma-next/utils/casts';
import type { Contract } from '../prisma/contract.d';
import { createOrmClient } from './client';

type PostId = DefaultModelRow<Contract, 'Post'>['id'];

/**
 * Many-to-many include example: fetch a post along with its tags via the
 * Post.tags N:M relation. Demonstrates `.include('tags', ...)` traversing
 * the junction table transparently.
 */
export async function ormClientGetPostTags(postId: string, runtime: Runtime) {
  const db = createOrmClient(runtime);
  return db.Post.include('tags', (tag) => tag.select('id', 'label').orderBy((t) => t.label.asc()))
    .where({ id: castAs<PostId>(postId) })
    .first();
}
