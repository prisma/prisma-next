import { int4Column } from '@prisma-next/adapter-postgres/column-types';
import { encryptedDouble } from '@prisma-next/extension-cipherstash/column-types';
import { defineContract, field, model } from '@prisma-next/postgres/contract-builder';

export const contract = defineContract({
  models: {
    User: model('User', {
      fields: {
        id: field.column(int4Column).id(),
        salary: field.column(encryptedDouble()),
      },
    }).sql({ table: 'user' }),
  },
});
