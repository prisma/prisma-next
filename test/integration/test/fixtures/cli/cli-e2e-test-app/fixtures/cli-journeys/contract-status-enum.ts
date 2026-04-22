import {
  enumColumn,
  enumType,
  int4Column,
  textColumn,
} from '@prisma-next/adapter-postgres/column-types';
import sqlFamily from '@prisma-next/family-sql/pack';
import { defineContract, field, model } from '@prisma-next/sql-contract-ts/contract-builder';
import postgresPack from '@prisma-next/target-postgres/pack';

/**
 * From-state for the enum-rebuild journey: a `status` enum with three
 * values (`active`, `pending`, `archived`) referenced by
 * `User.status`. Pairs with `contract-status-enum-shrunk.ts`, which
 * removes `pending` and triggers the rebuild recipe.
 */
export const contract = defineContract({
  family: sqlFamily,
  target: postgresPack,
  types: {
    status: enumType('status', ['active', 'pending', 'archived']),
  },
  models: {
    User: model('User', {
      fields: {
        id: field.column(int4Column).id(),
        email: field.column(textColumn),
        status: field.column(enumColumn('status', 'status')),
      },
    }).sql({ table: 'user' }),
  },
});
