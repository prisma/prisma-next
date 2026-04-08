import {
  boolColumn,
  enumType,
  float8Column,
  int4Column,
  jsonbColumn,
  textColumn,
  timestamptzColumn,
} from '@prisma-next/adapter-postgres/column-types';
import sqlFamily from '@prisma-next/family-sql/pack';
import { defineContract, field, model } from '@prisma-next/sql-contract-ts/contract-builder';
import postgresPack from '@prisma-next/target-postgres/pack';

const types = {
  Email: {
    codecId: 'pg/text@1',
    nativeType: 'text',
    typeParams: {},
  },
  Role: enumType('Role', ['USER', 'ADMIN']),
} as const;

const User = model('User', {
  fields: {
    id: field.column(int4Column).defaultSql('autoincrement()').id(),
    email: field.namedType(types.Email).unique(),
    role: field.namedType(types.Role),
    createdAt: field.column(timestamptzColumn).defaultSql('now()'),
    isActive: field.column(boolColumn).default(true),
    profile: field.column(jsonbColumn).optional(),
  },
}).sql({ table: 'user' });

const Post = model('Post', {
  fields: {
    id: field.column(int4Column).defaultSql('autoincrement()').id(),
    userId: field.column(int4Column),
    title: field.column(textColumn),
    rating: field.column(float8Column).optional(),
  },
})
  .attributes(({ fields, constraints }) => ({
    uniques: [constraints.unique([fields.title, fields.userId])],
  }))
  .sql(({ cols, constraints }) => ({
    table: 'post',
    indexes: [constraints.index(cols.userId)],
    foreignKeys: [
      constraints.foreignKey(cols.userId, User.refs.id, {
        onDelete: 'cascade',
        onUpdate: 'cascade',
      }),
    ],
  }));

export const contract = defineContract({
  family: sqlFamily,
  target: postgresPack,
  types,
  models: {
    User,
    Post,
  },
});
