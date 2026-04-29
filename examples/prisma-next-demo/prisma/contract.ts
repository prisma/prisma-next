import type {} from '@prisma-next/extension-arktype-json/codec-types';
import { arktypeJson } from '@prisma-next/extension-arktype-json/column-types';
import arktypeJsonPack from '@prisma-next/extension-arktype-json/pack';
import pgvector from '@prisma-next/extension-pgvector/pack';
import sqlFamily from '@prisma-next/family-sql/pack';
import { defineContract, rel } from '@prisma-next/sql-contract-ts/contract-builder';
import postgresPack from '@prisma-next/target-postgres/pack';
import { type as arktype } from 'arktype';

const addressSchema = arktype({
  street: 'string',
  city: 'string',
  'zip?': 'string',
  country: 'string',
});

export const contract = defineContract(
  {
    family: sqlFamily,
    target: postgresPack,
    extensionPacks: { pgvector, arktypeJson: arktypeJsonPack },
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
  },
  ({ field, model, type }) => {
    const types = {
      Embedding1536: type.pgvector.Vector(1536),
      user_type: type.enum('user_type', ['admin', 'user'] as const),
    } as const;

    const User = model('User', {
      fields: {
        id: field.id.uuidv4(),
        email: field.text(),
        createdAt: field.createdAt(),
        kind: field.namedType(types.user_type),
        // Schema-validated JSON column via the per-library extension. The
        // column's TS type resolves to the schema's inferred output through
        // arktype's `expression`-driven `renderOutputType`.
        address: field.column(arktypeJson(addressSchema)).optional(),
      },
    });

    const Post = model('Post', {
      fields: {
        id: field.id.uuidv4(),
        title: field.text(),
        userId: field.uuid(),
        createdAt: field.createdAt(),
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
