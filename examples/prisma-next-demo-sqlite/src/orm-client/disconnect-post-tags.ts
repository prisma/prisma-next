import type { DefaultModelRow } from '@prisma-next/sql-orm-client';
import type { Runtime } from '@prisma-next/sql-runtime';
import { castAs } from '@prisma-next/utils/casts';
import type { Contract } from '../prisma/contract.d';
import { createOrmClient } from './client';

type PostId = DefaultModelRow<Contract, 'Post'>['id'];
type TagId = DefaultModelRow<Contract, 'Tag'>['id'];

/**
 * Many-to-many disconnect example: unlink tags from a post by deleting the
 * corresponding junction rows. Returns the post with its remaining tags.
 */
export async function ormClientDisconnectPostTags(
  postId: string,
  tagIds: readonly string[],
  runtime: Runtime,
) {
  const db = createOrmClient(runtime);
  const updated = await db.Post.where({ id: castAs<PostId>(postId) }).update({
    tags: (t) => t.disconnect(tagIds.map((id) => ({ id: castAs<TagId>(id) }))),
  });
  if (!updated) {
    return null;
  }
  return db.Post.include('tags', (tag) => tag.select('id', 'label').orderBy((t) => t.label.asc()))
    .where({ id: castAs<PostId>(postId) })
    .first();
}
