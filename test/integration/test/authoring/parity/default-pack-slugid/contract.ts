import sqlFamily from '@prisma-next/family-sql/pack';
import { defineContract, field, model } from '@prisma-next/sql-contract-ts/contract-builder';
import postgresPack from '@prisma-next/target-postgres/pack';

export const contract = defineContract({
  family: sqlFamily,
  target: postgresPack,
  models: {
    User: model('User', {
      fields: {
        id: field
          .generated({
            type: { codecId: 'pg/text@1', nativeType: 'text' },
            generated: { kind: 'generator', id: 'slugid' },
          })
          .id(),
      },
    }).sql({ table: 'user' }),
  },
});
