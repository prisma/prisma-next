import type { DefaultModelRow } from '@prisma-next/sql-orm-client';
import type { Runtime } from '@prisma-next/sql-runtime';
import { blindCast } from '@prisma-next/utils/casts';
import type { Contract } from '../prisma/contract.d';
import { createOrmClient } from './client';

type TagId = DefaultModelRow<Contract, 'Tag'>['id'];

/**
 * Many-to-many reverse-direction include example: fetch a tag along with the
 * posts that carry it via the Tag.posts N:M relation — the same PostTag
 * junction as Post.tags, walked from the other side.
 */
export async function ormClientGetTagPosts(tagId: string, runtime: Runtime) {
  const db = createOrmClient(runtime);
  return db.Tag.select('id', 'label')
    .include('posts', (post) => post.select('id', 'title').orderBy((p) => p.title.asc()))
    .where({ id: toTagId(tagId) })
    .first();
}

function toTagId(value: string): TagId {
  return blindCast<
    TagId,
    'demo CLI supplies ids as plain strings; the contract brands Tag.id as a Char<36> uuid'
  >(value);
}
