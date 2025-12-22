import type { CodecTypes } from '@prisma-next/adapter-postgres/codec-types';
import { boolColumn, int4Column, textColumn } from '@prisma-next/adapter-postgres/column-types';
// Use relative import to avoid module resolution issues in test context
import { defineContract } from '../../../../../packages/2-sql/2-authoring/contract-ts/src/exports/contract-builder';

export const contract = defineContract<CodecTypes>()
  .target('postgres')
  .table('user', (t) =>
    t
      .column('id', { type: int4Column, nullable: false })
      .column('email', { type: textColumn, nullable: false })
      .primaryKey(['id']),
  )
  .table('post', (t) =>
    t
      .column('id', { type: int4Column, nullable: false })
      .column('userId', { type: int4Column, nullable: false })
      .column('title', { type: textColumn, nullable: false })
      .column('published', { type: boolColumn, nullable: false })
      .primaryKey(['id']),
  )
  .table('comment', (t) =>
    t
      .column('id', { type: int4Column, nullable: false })
      .column('postId', { type: int4Column, nullable: false })
      .column('content', { type: textColumn, nullable: false })
      .primaryKey(['id']),
  )
  .model('User', 'user', (m) => m.field('id', 'id').field('email', 'email'))
  .model('Post', 'post', (m) =>
    m.field('id', 'id').field('userId', 'userId').field('title', 'title'),
  )
  .model('Comment', 'comment', (m) =>
    m.field('id', 'id').field('postId', 'postId').field('content', 'content'),
  )
  .extensions({
    postgres: { version: '15.0.0' },
    pg: {},
  })
  .capabilities({
    postgres: {
      lateral: true,
      jsonAgg: true,
      returning: true,
    },
  })
  .build();
