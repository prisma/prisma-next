import type { DefaultModelRow } from '@prisma-next/sql-orm-client';
import type { Runtime } from '@prisma-next/sql-runtime';
import { blindCast } from '@prisma-next/utils/casts';
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
  return db.Post.where({ id: toPostId(postId) })
    .include('tags', (tag) => tag.select('id', 'label').orderBy((t) => t.label.asc()))
    .update({
      tags: (t) => t.connect(tagIds.map((id) => ({ id: toTagId(id) }))),
    });
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
