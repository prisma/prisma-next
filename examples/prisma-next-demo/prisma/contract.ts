import sqlFamily from '@prisma-next/family-sql/pack';
import { defineContract } from '@prisma-next/sql-contract-ts/contract-builder';
import postgresPack from '@prisma-next/target-postgres/pack';

export const contract = defineContract(
  { family: sqlFamily, target: postgresPack },
  ({ field, model, rel }) => ({
    models: {
      User: model('User', {
        fields: {
          id: field.id.uuidv7(),
          email: field.text().unique(),
          name: field.text().optional(),
          createdAt: field.createdAt(),
        },
      }).relations({
        posts: rel.hasMany('Post', { by: 'authorId' }),
      }),

      Post: model('Post', {
        fields: {
          id: field.id.uuidv7(),
          title: field.text(),
          content: field.text().optional(),
          authorId: field.text(),
          createdAt: field.createdAt(),
        },
      }).relations({
        author: rel.belongsTo('User', { from: 'authorId', to: 'id' }),
      }),
    },
  }),
);
