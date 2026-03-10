import type { CodecTypes as PgCodecTypes } from '@prisma-next/adapter-postgres/codec-types';
import {
  int4Column,
  textColumn,
  timestamptzColumn,
} from '@prisma-next/adapter-postgres/column-types';
import type { CodecTypes as PgVectorCodecTypes } from '@prisma-next/extension-pgvector/codec-types';
import { vectorColumn } from '@prisma-next/extension-pgvector/column-types';
import pgvector from '@prisma-next/extension-pgvector/pack';
import type {
  ExtractCodecTypes,
  ExtractTypeMapsFromContract,
  TypeMaps,
} from '@prisma-next/sql-contract/types';
import { defineContract } from '@prisma-next/sql-contract-ts/contract-builder';
import { sql } from '@prisma-next/sql-lane/sql';
import { schema } from '@prisma-next/sql-relational-core/schema';
import type { ResultType } from '@prisma-next/sql-relational-core/types';
import { createStubAdapter, createTestContext } from '@prisma-next/sql-runtime/test/utils';
import postgresPack from '@prisma-next/target-postgres/pack';
import { expectTypeOf, test } from 'vitest';

test('.target(postgresPack) infers CodecTypes without defineContract type param', () => {
  const contract = defineContract()
    .target(postgresPack)
    .table('user', (t) =>
      t
        .column('id', { type: int4Column, nullable: false })
        .column('email', { type: textColumn, nullable: false })
        .column('createdAt', { type: timestamptzColumn, nullable: false })
        .primaryKey(['id']),
    )
    .model('User', 'user', (m) =>
      m.field('id', 'id').field('email', 'email').field('createdAt', 'createdAt'),
    )
    .build();

  type InferredCodecTypes = ExtractCodecTypes<typeof contract>;
  expectTypeOf<InferredCodecTypes>().toExtend<PgCodecTypes>();
  expectTypeOf<InferredCodecTypes>().toHaveProperty('pg/int4@1');
  expectTypeOf<InferredCodecTypes>().toHaveProperty('pg/text@1');
  expectTypeOf<InferredCodecTypes>().toHaveProperty('pg/timestamptz@1');
});

test('.extensionPacks({ pgvector }) infers and accumulates pgvector codec types', () => {
  const contract = defineContract()
    .target(postgresPack)
    .table('post', (t) =>
      t
        .column('id', { type: int4Column, nullable: false })
        .column('embedding', { type: vectorColumn, nullable: true })
        .primaryKey(['id']),
    )
    .model('Post', 'post', (m) => m.field('id', 'id').field('embedding', 'embedding'))
    .extensionPacks({ pgvector })
    .build();

  type InferredCodecTypes = ExtractCodecTypes<typeof contract>;
  expectTypeOf<InferredCodecTypes>().toExtend<PgCodecTypes & PgVectorCodecTypes>();
  expectTypeOf<InferredCodecTypes>().toHaveProperty('pg/int4@1');
  expectTypeOf<InferredCodecTypes>().toHaveProperty('pg/vector@1');
});

test('defineContract<CodecTypes>() still works when explicit type param provided', () => {
  const contract = defineContract<PgCodecTypes>()
    .target(postgresPack)
    .table('user', (t) =>
      t
        .column('id', { type: int4Column, nullable: false })
        .column('email', { type: textColumn, nullable: false })
        .primaryKey(['id']),
    )
    .model('User', 'user', (m) => m.field('id', 'id').field('email', 'email'))
    .build();

  type InferredCodecTypes = ExtractCodecTypes<typeof contract>;
  expectTypeOf<InferredCodecTypes>().toExtend<PgCodecTypes>();
});

test('ExtractTypeMapsFromContract extracts TypeMaps from defineContract build result', () => {
  const contract = defineContract()
    .target(postgresPack)
    .table('user', (t) =>
      t
        .column('id', { type: int4Column, nullable: false })
        .column('email', { type: textColumn, nullable: false })
        .primaryKey(['id']),
    )
    .model('User', 'user', (m) => m.field('id', 'id').field('email', 'email'))
    .build();

  type Extracted = ExtractTypeMapsFromContract<typeof contract>;
  expectTypeOf<Extracted>().toExtend<TypeMaps<PgCodecTypes, Record<string, never>>>();
  expectTypeOf<Extracted['codecTypes']>().toHaveProperty('pg/int4@1');
});

test('schema and sql infer types from ContractWithTypeMaps without explicit TypeMaps param', () => {
  const contract = defineContract()
    .target(postgresPack)
    .table('user', (t) =>
      t
        .column('id', { type: int4Column, nullable: false })
        .column('email', { type: textColumn, nullable: false })
        .primaryKey(['id']),
    )
    .model('User', 'user', (m) => m.field('id', 'id').field('email', 'email'))
    .build();

  const adapter = createStubAdapter();
  const context = createTestContext(contract, adapter);
  const schemaHandle = schema(context);
  const userTable = schemaHandle.tables.user;
  if (!userTable) throw new Error('user table not found');

  const plan = sql<typeof contract>({ context })
    .from(userTable)
    .select({
      id: userTable.columns.id,
      email: userTable.columns.email,
    })
    .build();

  type Row = ResultType<typeof plan>;
  expectTypeOf<Row>().not.toEqualTypeOf<never>();
  expectTypeOf(plan).not.toEqualTypeOf<never>();
});

test('mixed target and extension pack composition accumulates codec types', () => {
  const contract = defineContract()
    .target(postgresPack)
    .table('doc', (t) =>
      t
        .column('id', { type: int4Column, nullable: false })
        .column('content', { type: textColumn, nullable: false })
        .column('embedding', { type: vectorColumn, nullable: true })
        .primaryKey(['id']),
    )
    .model('Doc', 'doc', (m) =>
      m.field('id', 'id').field('content', 'content').field('embedding', 'embedding'),
    )
    .extensionPacks({ pgvector })
    .build();

  type InferredCodecTypes = ExtractCodecTypes<typeof contract>;
  expectTypeOf<InferredCodecTypes>().toHaveProperty('pg/int4@1');
  expectTypeOf<InferredCodecTypes>().toHaveProperty('pg/text@1');
  expectTypeOf<InferredCodecTypes>().toHaveProperty('pg/vector@1');
});
