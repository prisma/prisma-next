import { int4Column, textColumn } from '@prisma-next/adapter-postgres/column-types';
import sqlFamily from '@prisma-next/family-sql/pack';
import { defineContract, field, model } from '@prisma-next/sql-contract-ts/contract-builder';
import postgresPack from '@prisma-next/target-postgres/pack';

/**
 * Adds a NOT NULL `name` column with no default to `User`. The Postgres
 * issue-planner's `notNullBackfillCallStrategy` matches this case and
 * emits `addColumn(nullable) → DataTransformCall(placeholder slots) →
 * setNotNull`, so a test driving `migration plan` against this contract
 * gets a `placeholder()`-stubbed `migration.ts` to fill in.
 */
export const contract = defineContract({
  family: sqlFamily,
  target: postgresPack,
  models: {
    User: model('User', {
      fields: {
        id: field.column(int4Column).id(),
        email: field.column(textColumn),
        name: field.column(textColumn),
      },
    }).sql({ table: 'user' }),
  },
});
