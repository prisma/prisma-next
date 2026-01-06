import type { CodecTypes } from '@prisma-next/adapter-postgres/codec-types';
import { textColumn, timestamptzColumn } from '@prisma-next/adapter-postgres/column-types';
import { defineContract } from '@prisma-next/sql-contract-ts/contract-builder';
import postgresPack from '@prisma-next/target-postgres/pack';

export const contract = defineContract<CodecTypes>()
  .target(postgresPack)
  .table('User', (t) =>
    t
      .column('id', { type: textColumn, nullable: false })
      .column('email', { type: textColumn, nullable: false })
      .column('name', { type: textColumn, nullable: false })
      .column('createdAt', { type: timestamptzColumn, nullable: false })
      .primaryKey(['id']),
  )
  .model('User', 'User', (m) =>
    m
      .field('id', 'id')
      .field('email', 'email')
      .field('name', 'name')
      .field('createdAt', 'createdAt'),
  )
  .capabilities({
    postgres: {
      lateral: true,
      jsonAgg: true,
    },
  })
  .build();
