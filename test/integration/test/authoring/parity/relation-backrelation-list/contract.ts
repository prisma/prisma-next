import { int4Column } from '@prisma-next/adapter-postgres/column-types';
import sqlFamily from '@prisma-next/family-sql/pack';
import { defineContract, field, model, rel } from '@prisma-next/sql-contract-ts/contract-builder';
import postgresPack from '@prisma-next/target-postgres/pack';

const UserBase = model('User', {
  fields: {
    id: field.column(int4Column).id(),
  },
});

const Post = model('Post', {
  fields: {
    id: field.column(int4Column).id(),
    userId: field.column(int4Column),
  },
  relations: {
    user: rel.belongsTo(UserBase, { from: 'userId', to: 'id' }).sql({
      fk: { onDelete: 'cascade', onUpdate: 'cascade' },
    }),
  },
}).sql({ table: 'post' });

const User = UserBase.relations({
  posts: rel.hasMany(() => Post, { by: 'userId' }),
}).sql({ table: 'user' });

export const contract = defineContract({
  family: sqlFamily,
  target: postgresPack,
  models: {
    User,
    Post,
  },
});
