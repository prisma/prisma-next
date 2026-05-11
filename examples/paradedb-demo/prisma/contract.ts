import { int4Column, textColumn } from '@prisma-next/adapter-postgres/column-types';
import paradedb from '@prisma-next/extension-paradedb/pack';
import sqlFamily from '@prisma-next/family-sql/pack';
import { defineContract } from '@prisma-next/sql-contract-ts/contract-builder';
import postgresPack from '@prisma-next/target-postgres/pack';

export const contract = defineContract(
  {
    family: sqlFamily,
    target: postgresPack,
    extensionPacks: { paradedb },
    capabilities: {
      postgres: {
        lateral: true,
        returning: true,
        'paradedb/bm25': true,
      },
    },
  },
  ({ field, model }) => {
    const Item = model('Item', {
      fields: {
        id: field.column(int4Column).id(),
        description: field.column(textColumn),
        category: field.column(textColumn),
        rating: field.column(int4Column),
      },
    });

    return {
      models: {
        Item: Item.sql(({ cols, constraints }) => ({
          table: 'item',
          indexes: [
            constraints.index([cols.id, cols.description, cols.category, cols.rating], {
              type: 'bm25',
              options: { key_field: 'id' },
              name: 'item_bm25_idx',
            }),
          ],
        })),
      },
    };
  },
);
