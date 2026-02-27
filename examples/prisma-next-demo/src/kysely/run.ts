import type { Kysely } from 'kysely';
import { db } from '../prisma/db';

type DemoDb = Record<string, Record<string, unknown>>;

export function getDemoKysely(): Kysely<DemoDb> {
  return db.kysely as unknown as Kysely<DemoDb>;
}
