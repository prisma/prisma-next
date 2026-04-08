import { int4Column, textColumn } from '@prisma-next/adapter-postgres/column-types';
import { vectorColumn } from '@prisma-next/extension-pgvector/column-types';
import pgvector from '@prisma-next/extension-pgvector/pack';
import sqlFamily from '@prisma-next/family-sql/pack';
import { uuidv4 } from '@prisma-next/ids';
import { defineContract, field, model, rel } from '@prisma-next/sql-contract-ts/contract-builder';
import postgresPack from '@prisma-next/target-postgres/pack';

const UserBase = model('User', {
  fields: {
    id: field.column(int4Column).id(),
    name: field.column(textColumn),
    email: field.column(textColumn),
    invitedById: field.column(int4Column).optional().column('invited_by_id'),
  },
});

const Post = model('Post', {
  fields: {
    id: field.column(int4Column).id(),
    title: field.column(textColumn),
    userId: field.column(int4Column).column('user_id'),
    views: field.column(int4Column),
    embedding: field.column(vectorColumn).optional(),
  },
  relations: {
    comments: rel.hasMany(() => Comment, { by: 'postId' }),
    author: rel.belongsTo(UserBase, { from: 'userId', to: 'id' }),
  },
}).sql({ table: 'posts' });

const Comment = model('Comment', {
  fields: {
    id: field.column(int4Column).id(),
    body: field.column(textColumn),
    postId: field.column(int4Column).column('post_id'),
  },
}).sql({ table: 'comments' });

const Profile = model('Profile', {
  fields: {
    id: field.column(int4Column).id(),
    userId: field.column(int4Column).column('user_id'),
    bio: field.column(textColumn),
  },
}).sql({ table: 'profiles' });

const Article = model('Article', {
  fields: {
    id: field.generated(uuidv4()).id(),
    title: field.column(textColumn),
  },
}).sql({ table: 'articles' });

const User = UserBase.relations({
  invitedUsers: rel.hasMany(() => UserBase, { by: 'invitedById' }),
  invitedBy: rel.belongsTo(UserBase, { from: 'invitedById', to: 'id' }),
  posts: rel.hasMany(() => Post, { by: 'userId' }),
  profile: rel.hasOne(Profile, { by: 'userId' }),
}).sql({ table: 'users' });

export const contract = defineContract({
  family: sqlFamily,
  target: postgresPack,
  extensionPacks: { pgvector },
  capabilities: {
    sql: {
      lateral: true,
      returning: true,
      jsonAgg: true,
      enums: true,
      foreignKeys: true,
      autoIndexesForeignKeys: false,
    },
    postgres: {
      partialIndex: true,
      deferrableConstraints: true,
      savepoints: true,
      transactionalDDL: true,
      distinctOn: true,
    },
    pgvector: {
      ivfflat: true,
      hnsw: true,
      vector: true,
    },
  },
  models: {
    User,
    Post,
    Comment,
    Profile,
    Article,
  },
});
