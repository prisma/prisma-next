import type { CodecTypes } from '@prisma-next/adapter-postgres/codec-types';
import { int4Column } from '@prisma-next/adapter-postgres/column-types';
import { defineContract } from '@prisma-next/sql-contract-ts/contract-builder';
import postgresPack from '@prisma-next/target-postgres/pack';

export const contract = defineContract<CodecTypes>()
  .target(postgresPack)
  .table('user', (t) => t.column('id', { type: int4Column, nullable: false }).primaryKey(['id']))
  .model('User', 'user', (m) => m.field('id', 'id'))
  .build();
