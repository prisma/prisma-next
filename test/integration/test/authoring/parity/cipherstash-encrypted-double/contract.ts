import { int4Column } from '@prisma-next/adapter-postgres/column-types';
import { encryptedDouble } from '@prisma-next/extension-cipherstash/column-types';
import sqlFamily from '@prisma-next/family-sql/pack';
import { defineContract, field, model } from '@prisma-next/sql-contract-ts/contract-builder';
import postgresPack from '@prisma-next/target-postgres/pack';

export const contract = defineContract({
  family: sqlFamily,
  target: postgresPack,
  models: {
    User: model('User', {
      fields: {
        id: field.column(int4Column).id(),
        salary: field.column(encryptedDouble()),
      },
    }).sql({ table: 'user' }),
  },
});
