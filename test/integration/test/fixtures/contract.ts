import {
  int4Column,
  textColumn,
  timestamptzColumn,
} from '@prisma-next/adapter-postgres/column-types';
import { defineContract, field, model } from '@prisma-next/postgres/contract-builder';

export const contract = defineContract({
  models: {
    User: model('User', {
      fields: {
        id: field.column(int4Column).id(),
        email: field.column(textColumn),
        createdAt: field.column(timestamptzColumn),
      },
    }).sql({ table: 'user' }),
  },
});
