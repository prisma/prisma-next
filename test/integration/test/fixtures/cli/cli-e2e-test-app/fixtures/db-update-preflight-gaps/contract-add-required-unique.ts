import { int4Column, textColumn } from '@prisma-next/adapter-postgres/column-types';
import sqlFamily from '@prisma-next/family-sql/pack';
import { defineContract, field, model } from '@prisma-next/sql-contract-ts/contract-builder';
import postgresPack from '@prisma-next/target-postgres/pack';

const User = model('User', {
  fields: {
    id: field.column(int4Column).id(),
    email: field.column(textColumn),
    // New required-unique column without a default. The "shared temporary
    // default" strategy is unsafe here because seeding all existing rows with
    // the same placeholder would violate the new unique constraint, so the
    // planner falls back to the empty-table-guarded branch.
    handle: field.column(textColumn).unique(),
  },
}).sql({ table: 'user' });

const Post = model('Post', {
  fields: {
    id: field.column(int4Column).id(),
    title: field.column(textColumn),
    userId: field.column(int4Column),
  },
}).sql({ table: 'post' });

export const contract = defineContract({
  family: sqlFamily,
  target: postgresPack,
  models: {
    User,
    Post,
  },
});
