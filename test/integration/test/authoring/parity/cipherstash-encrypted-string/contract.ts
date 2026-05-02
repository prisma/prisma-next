import { int4Column } from '@prisma-next/adapter-postgres/column-types';
import { encryptedString } from '@prisma-next/extension-cipherstash/column-types';
import sqlFamily from '@prisma-next/family-sql/pack';
import { defineContract, field, model } from '@prisma-next/sql-contract-ts/contract-builder';
import postgresPack from '@prisma-next/target-postgres/pack';

export const contract = defineContract({
  family: sqlFamily,
  target: postgresPack,
  models: {
    EncryptedDoc: model('EncryptedDoc', {
      fields: {
        id: field.column(int4Column).defaultSql('autoincrement()').id(),
        storageOnly: field.column(encryptedString({})),
        equalityOnly: field.column(encryptedString({ equality: true })),
        searchable: field.column(encryptedString({ equality: true, freeTextSearch: true })),
        storageOnlyOpt: field.column(encryptedString({})).optional(),
        equalityOnlyOpt: field.column(encryptedString({ equality: true })).optional(),
        searchableOpt: field
          .column(encryptedString({ equality: true, freeTextSearch: true }))
          .optional(),
      },
    }).sql({ table: 'encrypted_doc' }),
  },
});
