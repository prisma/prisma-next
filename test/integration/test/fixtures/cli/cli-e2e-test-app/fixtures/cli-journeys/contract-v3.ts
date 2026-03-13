import type { CodecTypes } from '@prisma-next/adapter-postgres/codec-types';
import { int4Column, textColumn } from '@prisma-next/adapter-postgres/column-types';
import { defineContract } from '@prisma-next/sql-contract-ts/contract-builder';
import postgresPack from '@prisma-next/target-postgres/pack';

export const contract = defineContract<CodecTypes>()
  .target(postgresPack)
  .table('user', (t) =>
    t
      .column('id', { type: int4Column, nullable: false })
      .column('email', { type: textColumn, nullable: false })
      .column('name', { type: textColumn, nullable: true })
      .primaryKey(['id']),
  )
  .table('post', (t) =>
    t
      .column('id', { type: int4Column, nullable: false })
      .column('title', { type: textColumn, nullable: false })
      .column('userId', { type: int4Column, nullable: false })
      .primaryKey(['id'])
      .foreignKey(['userId'], { table: 'user', columns: ['id'] }),
  )
  .model('User', 'user', (m) => m.field('id', 'id').field('email', 'email').field('name', 'name'))
  .model('Post', 'post', (m) =>
    m.field('id', 'id').field('title', 'title').field('userId', 'userId'),
  )
  .build();
