import { uuidv4 } from '@prisma-next/ids';
import { defineContract, field, model } from '@prisma-next/postgres/contract-builder';

export const contract = defineContract({
  models: {
    User: model('User', {
      fields: {
        id: field.generated(uuidv4()).id(),
      },
    }).sql({ table: 'user' }),
  },
});
