// Default contract — identical to contract-base.ts.
// Journey tests swap this file to different contract variants during steps.
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
      .primaryKey(['id']),
  )
  .model('User', 'user', (m) => m.field('id', 'id').field('email', 'email'))
  .build();
