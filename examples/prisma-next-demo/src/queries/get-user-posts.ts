import { db } from '../prisma/db';
import { collect } from './utils';

export async function getUserPosts(userId: string, limit = 100) {
  return collect(
    db.sql.post
      .select('id', 'title', 'userId', 'createdAt', 'embedding')
      .where((f, fns) => fns.eq(f.userId, userId))
      .limit(limit)
      .all(),
  );
}
