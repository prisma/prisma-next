import type { Kysely } from 'kysely';
import { expectTypeOf, test } from 'vitest';
import type { Contract } from '../test/fixtures/generated/contract';
import type { KyselifyContract } from './kyselify';

type Database = KyselifyContract<Contract>;

declare const db: Kysely<Database>;

test('KyselifyContract converts Prisma Next contract to Kysely database schema', () => {
  const result = db
    .selectFrom('user')
    .innerJoin('post', (jb) => jb.onTrue())
    .select('post.id')
    .select('post.embedding')
    .executeTakeFirstOrThrow();

  expectTypeOf(result).toEqualTypeOf<Promise<{ id: number; embedding: number[] | null }>>();
});
