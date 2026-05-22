import pgvector from '@prisma-next/extension-pgvector/pack';
import { defineContract, rel } from '@prisma-next/postgres/contract-builder';

export const contract = defineContract(
  {
    extensionPacks: { pgvector },
    capabilities: {
      postgres: {
        lateral: true,
        jsonAgg: true,
        'pgvector.cosine': true,
        'defaults.now': true,
        'defaults.uuidv4': true,
      },
    },
  },
  ({ enum: enumEntity, field, model, type }) => {
    const types = {
      Embedding1536: type.pgvector.Vector(1536),
      user_type: enumEntity({ name: 'user_type', values: ['admin', 'user'] as const }),
    } as const;

    const User = model('User', {
      fields: {
        id: field.id.uuidv4(),
        email: field.text(),
        createdAt: field.temporal.createdAt(),
        updatedAt: field.temporal.updatedAt(),
        kind: field.namedType(types.user_type),
        address: field.json().optional(),
      },
    });

    const Post = model('Post', {
      fields: {
        id: field.id.uuidv4(),
        title: field.text(),
        userId: field.uuid(),
        createdAt: field.temporal.createdAt(),
        updatedAt: field.temporal.updatedAt(),
        embedding: field.namedType(types.Embedding1536).optional(),
      },
    });

    return {
      types,
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
