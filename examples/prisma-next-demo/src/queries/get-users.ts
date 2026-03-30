import { db } from '../prisma/db';
import { collect } from './utils';

export async function getUsers(limit = 10) {
  return collect(db.sql.user.select('id', 'email', 'createdAt', 'kind').limit(limit).all());
}
