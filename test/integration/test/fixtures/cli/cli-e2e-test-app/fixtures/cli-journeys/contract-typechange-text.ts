import { int4Column, textColumn } from '@prisma-next/adapter-postgres/column-types';
import sqlFamily from '@prisma-next/family-sql/pack';
import { defineContract, field, model } from '@prisma-next/sql-contract-ts/contract-builder';
import postgresPack from '@prisma-next/target-postgres/pack';

/**
 * Type-change *from*-state: a `score` column typed as `text`. Pairs with
 * `contract-typechange-int.ts` to drive an unsafe `text → int4` change
 * through the Postgres planner's `typeChangeCallStrategy`.
 */
export const contract = defineContract({
  family: sqlFamily,
  target: postgresPack,
  models: {
    User: model('User', {
      fields: {
        id: field.column(int4Column).id(),
        email: field.column(textColumn),
        score: field.column(textColumn),
      },
    }).sql({ table: 'user' }),
  },
});
