import {
  int4Column,
  textColumn,
  timestamptzColumn,
} from '@prisma-next/adapter-postgres/column-types';
import sqlFamily from '@prisma-next/family-sql/pack';
import { defineContract, field, model, rel } from '@prisma-next/sql-contract-ts/contract-builder';
import postgresPack from '@prisma-next/target-postgres/pack';

const UserBase = model('User', {
  fields: {
    id: field.column(int4Column).defaultSql('autoincrement()').id(),
    name: field.column(textColumn),
    email: field.column(textColumn),
    bio: field.column(textColumn).optional(),
  },
});

const Post = model('Post', {
  fields: {
    id: field.column(int4Column).defaultSql('autoincrement()').id(),
    authorId: field.column(int4Column),
    title: field.column(textColumn),
    publishedAt: field.column(timestamptzColumn).optional(),
  },
  relations: {
    author: rel.belongsTo(UserBase, { from: 'authorId', to: 'id' }).sql({ fk: {} }),
  },
}).sql({ table: 'posts' });

const User = UserBase.relations({
  posts: rel.hasMany(Post, { by: 'authorId' }),
}).sql({ table: 'users' });

export const contract = defineContract({
  family: sqlFamily,
  target: postgresPack,
  models: {
    User,
    Post,
  },
});
