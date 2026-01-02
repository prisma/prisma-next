import { defineContract } from '@prisma-next/sql-contract-ts/contract-builder';
import { int4Column, textColumn } from '@prisma-next/test-utils/column-descriptors';
import postgresPack from '@prisma-next/target-postgres/pack';

const contractObj = defineContract<Record<string, never>>()
  .target(postgresPack)
  .table('user', (t) =>
    t
      .column('id', { type: int4Column, nullable: false })
      .column('email', { type: textColumn, nullable: false })
      .primaryKey(['id']),
  )
  .model('User', 'user', (m) => m.field('id', 'id').field('email', 'email'))
  .build();

export const contract = {
  ...contractObj,
  extensionPacks: {
    postgres: {
      version: '0.0.1',
    },
    pg: {},
  },
};
