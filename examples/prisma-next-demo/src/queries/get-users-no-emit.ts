import type { Runtime } from '@prisma-next/sql-runtime';
import { createSql } from '../prisma-no-emit/context';
import { collect } from './utils';

export async function getUsers(runtime: Runtime, limit = 10) {
  const db = createSql(runtime);
  return collect(db.user.select('id', 'email', 'createdAt').limit(limit).all());
}
