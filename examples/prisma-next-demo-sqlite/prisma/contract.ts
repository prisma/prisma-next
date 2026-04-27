import { datetimeColumn, jsonColumn, textColumn } from '@prisma-next/adapter-sqlite/column-types';
import sqlFamily from '@prisma-next/family-sql/pack';
import { defineContract, rel } from '@prisma-next/sql-contract-ts/contract-builder';
import sqlitePack from '@prisma-next/target-sqlite/pack';

export type AddressInput = {
  readonly street: string;
  readonly city: string;
  readonly zip?: string | null;
  readonly country: string;
};

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
        email: field.column(textColumn),
        displayName: field.column(textColumn),
        createdAt: field.column(datetimeColumn).defaultSql('now()'),
        // SQLite has no native enums; `kind` is a plain text column whose
        // values are conventionally 'admin' or 'user'.
        kind: field.column(textColumn),
        address: field.column(jsonColumn).optional(),
      },
    });

    const Post = model('Post', {
      fields: {
        id: field.id.uuidv4(),
        title: field.column(textColumn),
        userId: field.uuid(),
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
  },
);
