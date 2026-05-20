import { int4Column, textColumn } from '@prisma-next/adapter-postgres/column-types';
import { defineContract, field, model } from '@prisma-next/postgres/contract-builder';

export const contract = defineContract({
  models: {
    User: model('User', {
      fields: {
        id: field.column(int4Column).id(),
        email: field.column(textColumn),
        phone: field.column(textColumn).optional(),
        bio: field.column(textColumn).optional(),
        avatarUrl: field.column(textColumn).optional(),
      },
    }).sql({ table: 'user' }),
  },
});
