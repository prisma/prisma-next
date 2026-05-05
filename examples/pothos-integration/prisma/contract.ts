import {
  datetimeColumn,
  integerColumn,
  textColumn,
} from '@prisma-next/adapter-sqlite/column-types';
import sqlFamily from '@prisma-next/family-sql/pack';
import { defineContract, rel } from '@prisma-next/sql-contract-ts/contract-builder';
import sqlitePack from '@prisma-next/target-sqlite/pack';

export const contract = defineContract(
  {
    family: sqlFamily,
    target: sqlitePack,
    capabilities: {
      sql: {
        returning: true,
        jsonAgg: true,
        lateral: false,
        enums: false,
        foreignKeys: true,
        autoIndexesForeignKeys: false,
      },
    },
  },
  ({ field, model }) => {
    const User = model('User', {
      fields: {
        id: field.id.uuidv4(),
        firstName: field.column(textColumn),
        lastName: field.column(textColumn),
        email: field.column(textColumn).unique(),
      },
    });

    const Post = model('Post', {
      fields: {
        id: field.id.uuidv4(),
        title: field.column(textColumn),
        content: field.column(textColumn),
        published: field.column(integerColumn).default(0),
        authorId: field.uuid(),
        createdAt: field.column(datetimeColumn).defaultSql('now()'),
      },
    });

    const Comment = model('Comment', {
      fields: {
        id: field.id.uuidv4(),
        body: field.column(textColumn),
        authorId: field.uuid(),
        postId: field.uuid(),
        createdAt: field.column(datetimeColumn).defaultSql('now()'),
      },
    });

    return {
      models: {
        User: User.relations({
          posts: rel.hasMany(Post, { by: 'authorId' }),
          comments: rel.hasMany(Comment, { by: 'authorId' }),
        }).sql({
          table: 'user',
        }),
        Post: Post.relations({
          author: rel.belongsTo(User, { from: 'authorId', to: 'id' }),
          comments: rel.hasMany(Comment, { by: 'postId' }),
        }).sql(({ cols, constraints }) => ({
          table: 'post',
          foreignKeys: [
            constraints.foreignKey(cols.authorId, User.refs.id, {
              name: 'post_authorId_fkey',
            }),
          ],
        })),
        Comment: Comment.relations({
          author: rel.belongsTo(User, { from: 'authorId', to: 'id' }),
          post: rel.belongsTo(Post, { from: 'postId', to: 'id' }),
        }).sql(({ cols, constraints }) => ({
          table: 'comment',
          foreignKeys: [
            constraints.foreignKey(cols.authorId, User.refs.id, {
              name: 'comment_authorId_fkey',
            }),
            constraints.foreignKey(cols.postId, Post.refs.id, {
              name: 'comment_postId_fkey',
            }),
          ],
        })),
      },
    };
  },
);
