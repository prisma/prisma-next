import { int4Column, textColumn } from '@prisma-next/adapter-postgres/column-types';
import { defineContract, field, model } from '@prisma-next/postgres/contract-builder';

const contractObj = defineContract({
  models: {
    User: model('User', {
      fields: {
        id: field.column(int4Column).id(),
        email: field.column(textColumn),
      },
    }).sql({ table: 'user' }),
  },
});

export const contract = {
  ...contractObj,
  extensions: {
    postgres: {
      version: '0.0.1',
    },
    pg: {},
  },
};
