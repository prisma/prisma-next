import type { CodecTypes } from '@prisma-next/adapter-postgres/codec-types';
import { uuidv4 } from '@prisma-next/ids';
import { defineContract } from '@prisma-next/sql-contract-ts/contract-builder';
import postgresPack from '@prisma-next/target-postgres/pack';

export const contract = defineContract<CodecTypes>()
  .target(postgresPack)
  .table('user', (t) => t.generated('id', uuidv4()).primaryKey(['id']))
  .model('User', 'user', (m) => m.field('id', 'id'))
  .build();
