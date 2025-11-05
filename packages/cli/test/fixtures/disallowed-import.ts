import { defineContract } from '@prisma-next/sql-query/contract-builder';
import type { CodecTypes } from '@prisma-next/adapter-postgres/codec-types';
// @ts-expect-error - This import is intentionally disallowed for testing
import { something } from 'some-other-package';

export const contract = defineContract<CodecTypes>()
  .target('postgres')
  .table('user', (t) =>
    t
      .column('id', 'int4', { nullable: false })
      .column('email', 'text', { nullable: false })
      .primaryKey(['id']),
  )
  .model('User', 'user', (m) => m.field('id', 'id').field('email', 'email'))
  .build();

