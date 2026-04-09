import sqlFamily from '@prisma-next/family-sql/pack';
import { cuid2 } from '@prisma-next/ids';
import { defineContract, field, model } from '@prisma-next/sql-contract-ts/contract-builder';
import postgresPack from '@prisma-next/target-postgres/pack';

export const contract = defineContract({
  family: sqlFamily,
  target: postgresPack,
  models: {
    User: model('User', {
      fields: {
        id: field.generated(cuid2()).id(),
      },
    }).sql({ table: 'user' }),
  },
});
