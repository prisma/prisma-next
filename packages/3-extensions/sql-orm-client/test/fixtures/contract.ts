import { int4Column, jsonbColumn, textColumn } from '@prisma-next/adapter-postgres/column-types';
import sqlFamily from '@prisma-next/family-sql/pack';
import { uuidv4 } from '@prisma-next/ids';
import { defineContract, field, model, rel } from '@prisma-next/sql-contract-ts/contract-builder';
import postgresPack from '@prisma-next/target-postgres/pack';

const UserBase = model('User', {
  fields: {
    id: field.column(int4Column).id(),
    name: field.column(textColumn),
    email: field.column(textColumn).unique(),
    invitedById: field.column(int4Column).optional().column('invited_by_id'),
    address: field.column(jsonbColumn).optional(),
  },
});

const PostBase = model('Post', {
  fields: {
    id: field.column(int4Column).id(),
    title: field.column(textColumn),
    userId: field.column(int4Column).column('user_id'),
    views: field.column(int4Column),
  },
});

const Comment = model('Comment', {
  fields: {
    id: field.column(int4Column).id(),
    body: field.column(textColumn),
    postId: field.column(int4Column).column('post_id'),
  },
}).sql(({ cols, constraints }) => ({
  table: 'comments',
  foreignKeys: [constraints.foreignKey(cols.postId, PostBase.refs.id)],
}));

const Profile = model('Profile', {
  fields: {
    id: field.column(int4Column).id(),
    userId: field.column(int4Column).column('user_id').unique(),
    bio: field.column(textColumn),
  },
  relations: {
    user: rel.belongsTo(UserBase, { from: 'userId', to: 'id' }).sql({ fk: {} }),
  },
}).sql({ table: 'profiles' });

const Article = model('Article', {
  fields: {
    id: field.column(int4Column).id(),
    title: field.column(textColumn),
    reviewerId: field.column(int4Column).column('reviewer_id'),
  },
  relations: {
    reviewer: rel.belongsTo(UserBase, { from: 'reviewerId', to: 'id' }),
  },
}).sql({ table: 'articles' });

const Tag = model('Tag', {
  fields: {
    id: field.generated(uuidv4()).id(),
    name: field.column(textColumn).unique(),
  },
}).sql({ table: 'tags' });

const Post = PostBase.relations({
  comments: rel.hasMany(() => Comment, { by: 'postId' }),
  author: rel.belongsTo(UserBase, { from: 'userId', to: 'id' }).sql({ fk: {} }),
}).sql({ table: 'posts' });

const User = UserBase.relations({
  invitedUsers: rel.hasMany(() => User, { by: 'invitedById' }),
  invitedBy: rel.belongsTo(UserBase, { from: 'invitedById', to: 'id' }).sql({ fk: {} }),
  posts: rel.hasMany(() => Post, { by: 'userId' }),
  profile: rel.hasOne(() => Profile, { by: 'userId' }),
}).sql({ table: 'users' });

const baseContract = defineContract({
  family: sqlFamily,
  target: postgresPack,
  models: {
    User,
    Post,
    Comment,
    Profile,
    Article,
    Tag,
  },
});

const userModel = baseContract.models['User']!;

export const contract = {
  ...baseContract,
  models: {
    ...baseContract.models,
    User: {
      ...userModel,
      fields: {
        ...userModel.fields,
        address: {
          nullable: true as const,
          type: { kind: 'valueObject' as const, name: 'Address' },
        },
      },
    },
  },
  valueObjects: {
    Address: {
      fields: {
        street: {
          nullable: false as const,
          type: { kind: 'scalar' as const, codecId: 'pg/text@1' as const },
        },
        city: {
          nullable: false as const,
          type: { kind: 'scalar' as const, codecId: 'pg/text@1' as const },
        },
        zip: {
          nullable: true as const,
          type: { kind: 'scalar' as const, codecId: 'pg/text@1' as const },
        },
      },
    },
  },
};
