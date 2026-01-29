import { defineContract } from '@prisma-next/sql-contract-ts/contract-builder';
import { int4Column, textColumn } from '@prisma-next/test-utils/column-descriptors';
import { postgresPack } from '../helpers/postgres-pack';

// Minimal stub CodecTypes for test fixtures (CLI doesn't need full type inference)
type CodecTypes = Record<string, never>;

const contractObj = defineContract<CodecTypes>()
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
  },
};
