import type { CodecTypes } from '@prisma-next/adapter-postgres/codec-types';
import { textColumn } from '@prisma-next/adapter-postgres/column-types';
import { defineContract } from '@prisma-next/sql-contract-ts/contract-builder';
import postgresPack from '@prisma-next/target-postgres/pack';

export const contract = defineContract<CodecTypes>()
  .target(postgresPack)
  .table('user', (t) =>
    t
      .column('id', {
        type: textColumn,
        default: { kind: 'function', expression: 'gen_random_uuid()' },
      })
      .primaryKey(['id']),
  )
  .model('User', 'user', (m) => m.field('id', 'id'))
  .build();
