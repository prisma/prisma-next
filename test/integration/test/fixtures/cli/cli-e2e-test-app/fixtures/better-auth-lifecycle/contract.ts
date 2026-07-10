import { textColumn } from '@prisma-next/adapter-postgres/column-types';
import { defineContract, field, model } from '@prisma-next/postgres/contract-builder';

// Minimal app-space contract: the app brings one table of its own so the
// aggregate exercises app-space + extension-space planning together.
export const contract = defineContract({
  models: {
    Todo: model('Todo', {
      fields: {
        id: field.column(textColumn).id(),
        title: field.column(textColumn),
      },
    }).sql({ table: 'todo' }),
  },
});
