import { int4Column, textColumn } from '@prisma-next/adapter-postgres/column-types';
import sqlFamily from '@prisma-next/family-sql/pack';
import { defineContract, field, model } from '@prisma-next/sql-contract-ts/contract-builder';
import postgresPack from '@prisma-next/target-postgres/pack';

/**
 * From-state for the nullable-tightening journey: `User.name` is
 * present but nullable. Pairs with `contract-nullable-name-required.ts`,
 * which flips it to NOT NULL and is the input to
 * `nullableTighteningCallStrategy`.
 */
export const contract = defineContract({
  family: sqlFamily,
  target: postgresPack,
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
