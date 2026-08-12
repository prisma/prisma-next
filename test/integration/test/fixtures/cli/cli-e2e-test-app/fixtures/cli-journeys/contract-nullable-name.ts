import { int4Column, textColumn } from '@prisma-next/adapter-postgres/column-types';
import { defineContract, field, model } from '@prisma-next/postgres/contract-builder';

/**
 * From-state for the nullable-tightening journey: `User.name` is
 * present but nullable. Pairs with `contract-nullable-name-required.ts`,
 * which flips it to NOT NULL and is the input to
 * `nullableTighteningCallStrategy`.
 */
export const contract = defineContract({
  models: {
    User: model('User', {
      fields: {
        id: field.column(int4Column).id(),
        email: field.column(textColumn),
        name: field.column(textColumn).optional(),
      },
    }).sql({ table: 'user' }),
  },
});
