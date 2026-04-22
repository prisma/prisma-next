import sqlFamily from '@prisma-next/family-sql/pack';
import { defineContract, rel } from '@prisma-next/sql-contract-ts/contract-builder';
import postgresPack from '@prisma-next/target-postgres/pack';

export const contract = defineContract(
  {
    family: sqlFamily,
    target: postgresPack,
    capabilities: {
      postgres: {
        lateral: true,
        jsonAgg: true,
        returning: true,
        'defaults.now': true,
        'defaults.uuidv4': true,
      },
    },
  },
  ({ field, model }) => {
    const User = model('User', {
      fields: {
        id: field.id.uuidv4(),
        email: field.text(),
        createdAt: field.createdAt(),
      },
    });

    const Post = model('Post', {
      fields: {
        id: field.id.uuidv4(),
        title: field.text(),
        userId: field.uuid(),
        createdAt: field.createdAt(),
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
  },
);
