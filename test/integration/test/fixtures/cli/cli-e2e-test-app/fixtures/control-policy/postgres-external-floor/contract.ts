import { int4Column, textColumn } from '@prisma-next/adapter-postgres/column-types';
import { defineContract, field, model } from '@prisma-next/postgres/contract-builder';

export const contract = defineContract({
  defaultControlPolicy: 'external',
  namespaces: ['auth'],
  models: {
    AuthSessions: model('AuthSessions', {
      namespace: 'auth',
      fields: {
        id: field.column(int4Column).id(),
        user_id: field.column(textColumn),
      },
    }).sql({ table: 'sessions', control: 'managed' }),
  },
});
