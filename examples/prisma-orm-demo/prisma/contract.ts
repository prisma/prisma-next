import type { CodecTypes } from '@prisma-next/adapter-postgres/codec-types';
import { defineContract } from '@prisma-next/sql-query/contract-builder';

export const contract = defineContract<CodecTypes>()
  .target('postgres')
  .table('User', (t) =>
    t
      .column('id', { type: 'pg/text@1', nullable: false })
      .column('email', { type: 'pg/text@1', nullable: false })
      .column('name', { type: 'pg/text@1', nullable: false })
      .column('createdAt', { type: 'pg/timestamptz@1', nullable: false })
      .primaryKey(['id']),
  )
  .model('User', 'User', (m) =>
    m
      .field('id', 'id')
      .field('email', 'email')
      .field('name', 'name')
      .field('createdAt', 'createdAt'),
  )
  .extensions({
    postgres: {
      version: '15.0.0',
    },
    pg: {},
  })
  .capabilities({
    postgres: {
      lateral: true,
      jsonAgg: true,
    },
  })
  .build();

