import { int4Column } from '@prisma-next/adapter-postgres/column-types';
import { encryptedJson } from '@prisma-next/extension-cipherstash/column-types';
import { defineContract, field, model } from '@prisma-next/postgres/contract-builder';

export const contract = defineContract({
  models: {
    User: model('User', {
      fields: {
        id: field.column(int4Column).id(),
        preferences: field.column(encryptedJson()),
      },
    }).sql({ table: 'user' }),
  },
});
