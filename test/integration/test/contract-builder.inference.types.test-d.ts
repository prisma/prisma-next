/**
 * Type tests for defineContract() inference from .target() and .extensionPacks().
 * Verifies that codec/op type maps are inferred from packs without manual type composition.
 */

import type { CodecTypes as PgCodecTypes } from '@prisma-next/adapter-postgres/codec-types';
import {
  int4Column,
  textColumn,
  timestamptzColumn,
} from '@prisma-next/adapter-postgres/column-types';
import type { CodecTypes as PgVectorCodecTypes } from '@prisma-next/extension-pgvector/codec-types';
import { vectorColumn } from '@prisma-next/extension-pgvector/column-types';
import pgvector from '@prisma-next/extension-pgvector/pack';
import type { ExtractCodecTypes } from '@prisma-next/sql-contract/types';
import { defineContract } from '@prisma-next/sql-contract-ts/contract-builder';
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
  expectTypeOf<InferredCodecTypes>().toMatchTypeOf<PgCodecTypes>();
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
  expectTypeOf<InferredCodecTypes>().toMatchTypeOf<PgCodecTypes & PgVectorCodecTypes>();
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
  expectTypeOf<InferredCodecTypes>().toMatchTypeOf<PgCodecTypes>();
});
