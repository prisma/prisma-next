import type { CodecTypes } from '@prisma-next/adapter-postgres/codec-types';
import { int4Column, textColumn } from '@prisma-next/adapter-postgres/column-types';
import { defineContract } from '@prisma-next/sql-contract-ts/contract-builder';

// pg extension is needed because codec IDs like 'pg/int4@1' reference the 'pg' namespace
// postgres extension provides target-level metadata
export const contract = defineContract<CodecTypes>()
  .target('postgres')
  .extensions({
    postgres: { version: '15.0.0' },
    pg: {},
  })
  .table('user', (t) =>
    t
      .column('id', { type: int4Column, nullable: false })
      .column('email', { type: textColumn, nullable: false })
      .primaryKey(['id']),
  )
  .model('User', 'user', (m) => m.field('id', 'id').field('email', 'email'))
  .build();
