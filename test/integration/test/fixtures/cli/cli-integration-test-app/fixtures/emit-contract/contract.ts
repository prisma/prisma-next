import sqlFamily from '@prisma-next/family-sql/pack';
import { defineContract, field, model } from '@prisma-next/sql-contract-ts/contract-builder';
import postgresPack from '@prisma-next/target-postgres/pack';
import { int4Column, textColumn } from '@prisma-next/test-utils/column-descriptors';

const contractObj = defineContract({
  family: sqlFamily,
  target: postgresPack,
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
  extensionPacks: {
    postgres: {
      version: '0.0.1',
    },
    pg: {},
  },
};
