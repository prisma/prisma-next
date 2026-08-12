import { int4Column, textColumn } from '@prisma-next/adapter-postgres/column-types';
import { defineContract, field, model } from '@prisma-next/postgres/contract-builder';

const User = model('User', {
  fields: {
    id: field.column(int4Column).id(),
    email: field.column(textColumn),
    name: field.column(textColumn).optional(),
  },
}).sql({ table: 'user' });

const Post = model('Post', {
  fields: {
    id: field.column(int4Column).id(),
    title: field.column(textColumn),
    userId: field.column(int4Column),
  },
}).sql(({ cols, constraints }) => ({
  table: 'post',
  foreignKeys: [constraints.foreignKey(cols.userId, User.refs.id)],
}));

export const contract = defineContract({
  models: {
    User,
    Post,
  },
});
