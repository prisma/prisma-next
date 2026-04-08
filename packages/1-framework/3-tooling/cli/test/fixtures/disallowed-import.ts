import sqlFamily from '@prisma-next/family-sql/pack';
import { defineContract, field, model } from '@prisma-next/sql-contract-ts/contract-builder';
import { int4Column, textColumn } from '@prisma-next/test-utils/column-descriptors';
// @ts-expect-error - This import is intentionally disallowed for testing
// biome-ignore lint/correctness/noUnusedImports: Intentionally unused for testing disallowed imports
import { something } from 'some-other-package';
import { postgresPack } from '../helpers/postgres-pack';

export const contract = defineContract({
  family: sqlFamily,
  target: postgresPack,
  models: {
    User: model('User', {
      fields: {
        id: field.column(int4Column).id(),
        email: field.column(textColumn),
      },
    }).sql({ table: 'user' }),
  },
});
