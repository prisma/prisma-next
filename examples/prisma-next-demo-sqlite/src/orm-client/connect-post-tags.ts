import type { DefaultModelRow } from '@prisma-next/sql-orm-client';
import type { Runtime } from '@prisma-next/sql-runtime';
import type { Contract } from '../prisma/contract.d';
import { createOrmClient } from './client';

type PostId = DefaultModelRow<Contract, 'Post'>['id'];
type TagId = DefaultModelRow<Contract, 'Tag'>['id'];

/**
 * Many-to-many connect example: link existing tags to a post via the
 * callback mutator. Inserts junction rows for each tag id supplied; does
 * not create new tags. Returns the post with its updated tag list included.
 */
export async function ormClientConnectPostTags(
  postId: string,
  tagIds: readonly string[],
  runtime: Runtime,
) {
  const db = createOrmClient(runtime);
  const updated = await db.Post.where({ id: postId as PostId }).update({
    tags: (t) => t.connect(tagIds.map((id) => ({ id: id as TagId }))),
  });
  if (!updated) {
    return null;
  }
  return db.Post.include('tags', (tag) => tag.orderBy((t) => t.label.asc()))
    .where({ id: postId as PostId })
    .first();
}
