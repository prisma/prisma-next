import type { DefaultModelRow } from '@prisma-next/sql-orm-client';
import type { Runtime } from '@prisma-next/sql-runtime';
import { blindCast } from '@prisma-next/utils/casts';
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
  const updated = await db.Post.where({ id: toPostId(postId) }).update({
    tags: (t) => t.disconnect(tagIds.map((id) => ({ id: toTagId(id) }))),
  });
  if (!updated) {
    return null;
  }
  return db.Post.select('id', 'title')
    .include('tags', (tag) => tag.select('id', 'label').orderBy((t) => t.label.asc()))
    .where({ id: toPostId(postId) })
    .first();
}

function toPostId(value: string): PostId {
  return blindCast<
    PostId,
    'demo CLI supplies ids as plain strings; the contract brands Post.id as a Char<36> uuid'
  >(value);
}

function toTagId(value: string): TagId {
  return blindCast<
    TagId,
    'demo CLI supplies ids as plain strings; the contract brands Tag.id as a Char<36> uuid'
  >(value);
}
