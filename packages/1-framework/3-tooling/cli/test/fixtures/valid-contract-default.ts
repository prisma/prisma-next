import { defineContract, field, model } from '@prisma-next/sql-contract-ts/contract-builder';
import { int4Column, textColumn } from '@prisma-next/test-utils/column-descriptors';
import { postgresPack } from '../helpers/postgres-pack';
import { sqlFamilyPack } from '../helpers/sql-family-pack';

const contractObj = defineContract({
  family: sqlFamilyPack,
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

export default {
  ...contractObj,
  extensionPacks: {
    postgres: {
      version: '0.0.1',
    },
    pg: {},
  },
};
