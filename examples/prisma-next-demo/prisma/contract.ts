import {
  enumType,
  jsonbColumn,
  textColumn,
  timestamptzColumn,
} from '@prisma-next/adapter-postgres/column-types';
import { vector } from '@prisma-next/extension-pgvector/column-types';
import pgvector from '@prisma-next/extension-pgvector/pack';
import sqlFamily from '@prisma-next/family-sql/pack';
import { uuidv4 } from '@prisma-next/ids';
import { defineContract, field, model, rel } from '@prisma-next/sql-contract-ts/contract-builder';
import postgresPack from '@prisma-next/target-postgres/pack';

const types = {
  Embedding1536: vector(1536),
  user_type: enumType('user_type', ['admin', 'user']),
} as const;

const User = model('User', {
  fields: {
    id: field.generated(uuidv4()).id(),
    email: field.column(textColumn),
    createdAt: field.column(timestamptzColumn).defaultSql('now()'),
    kind: field.namedType(types.user_type),
    address: field.column(jsonbColumn).optional(),
  },
});

const Post = model('Post', {
  fields: {
    id: field.generated(uuidv4()).id(),
    title: field.column(textColumn),
    userId: field.column(textColumn),
    createdAt: field.column(timestamptzColumn).defaultSql('now()'),
    embedding: field.namedType(types.Embedding1536).optional(),
  },
});

const UserModel = User.relations({
  posts: rel.hasMany(Post, { by: 'userId' }),
}).sql({
  table: 'user',
});

const PostModel = Post.relations({
  user: rel.belongsTo(User, { from: 'userId', to: 'id' }),
}).sql(({ cols, constraints }) => ({
  table: 'post',
  foreignKeys: [
    constraints.foreignKey(cols.userId, User.refs.id, {
      name: 'post_userId_fkey',
    }),
  ],
}));

export const contract = defineContract({
  family: sqlFamily,
  target: postgresPack,
  extensionPacks: { pgvector },
  capabilities: {
    postgres: {
      lateral: true,
      jsonAgg: true,
      returning: true,
      'pgvector.cosine': true,
      'defaults.now': true,
      'defaults.uuidv4': true,
    },
  },
  types,
  models: {
    User: UserModel,
    Post: PostModel,
  },
});
