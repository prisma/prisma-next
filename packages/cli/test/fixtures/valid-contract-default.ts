import type { CodecTypes } from '@prisma-next/adapter-postgres/codec-types';
import { defineContract } from '@prisma-next/sql-contract-ts/contract-builder';

const contractObj = defineContract<CodecTypes>()
  .target('postgres')
  .table('user', (t) =>
    t
      .column('id', { type: 'pg/int4@1', nullable: false })
      .column('email', { type: 'pg/text@1', nullable: false })
      .primaryKey(['id']),
  )
  .model('User', 'user', (m) => m.field('id', 'id').field('email', 'email'))
  .build();

export default {
  ...contractObj,
  extensions: {
    postgres: {
      version: '15.0.0',
    },
    pg: {},
  },
};
