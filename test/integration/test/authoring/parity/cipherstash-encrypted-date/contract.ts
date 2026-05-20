import { int4Column } from '@prisma-next/adapter-postgres/column-types';
import { encryptedDate } from '@prisma-next/extension-cipherstash/column-types';
import { defineContract, field, model } from '@prisma-next/postgres/contract-builder';

export const contract = defineContract({
  models: {
    User: model('User', {
      fields: {
        id: field.column(int4Column).id(),
        birthday: field.column(encryptedDate()),
      },
    }).sql({ table: 'user' }),
  },
});
