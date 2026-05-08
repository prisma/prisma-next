import { int4Column } from '@prisma-next/adapter-postgres/column-types';
import { encryptedString } from '@prisma-next/extension-cipherstash/column-types';
import sqlFamily from '@prisma-next/family-sql/pack';
import { defineContract, field, model } from '@prisma-next/sql-contract-ts/contract-builder';
import postgresPack from '@prisma-next/target-postgres/pack';

export const contract = defineContract({
  family: sqlFamily,
  target: postgresPack,
  models: {
    User: model('User', {
      fields: {
        id: field.column(int4Column).defaultSql('autoincrement()').id(),
        storageOnly: field.column(encryptedString({})),
        equality: field.column(encryptedString({ equality: true })),
        full: field.column(encryptedString({ equality: true, freeTextSearch: true })),
        optionalStorageOnly: field.column(encryptedString({})).optional(),
        optionalEquality: field.column(encryptedString({ equality: true })).optional(),
        optionalFull: field
          .column(encryptedString({ equality: true, freeTextSearch: true }))
          .optional(),
      },
    }).sql({ table: 'user' }),
  },
});
