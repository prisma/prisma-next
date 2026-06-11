import { datetimeColumn, textColumn } from '@prisma-next/adapter-sqlite/column-types';
import { defineContract, rel } from '@prisma-next/sqlite/contract-builder';

export const contract = defineContract({}, ({ field, model }) => {
  const User = model('User', {
    fields: {
      id: field.id.uuidv4String(),
      email: field.column(textColumn),
      displayName: field.column(textColumn),
      createdAt: field.column(datetimeColumn).defaultSql('now()'),
    },
  });

  const Post = model('Post', {
    fields: {
      id: field.id.uuidv4String(),
      title: field.column(textColumn),
      userId: field.uuidString(),
      createdAt: field.column(datetimeColumn).defaultSql('now()'),
    },
  });

  return {
    models: {
      User: User.relations({
        posts: rel.hasMany(Post, { by: 'userId' }),
      }).sql({
        table: 'user',
      }),
      Post: Post.relations({
        user: rel.belongsTo(User, { from: 'userId', to: 'id' }),
      }).sql(({ cols, constraints }) => ({
        table: 'post',
        foreignKeys: [
          constraints.foreignKey(cols.userId, User.refs.id, {
            name: 'post_userId_fkey',
          }),
        ],
      })),
    },
  };
});
