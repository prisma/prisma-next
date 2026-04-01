import { db } from '../prisma/db';
import { collect } from './utils';

export async function getUsers(limit = 10) {
  const plan = db.sql.user.select('id', 'email', 'createdAt', 'kind').limit(limit).build();
  return collect(db.runtime().execute(plan));
}
