/**
 * Application contract for the multi-extension-monorepo example.
 *
 * Declares one user-owned `User` table, independent of the tables
 * contributed by the two internal extension packages (`audit_event`
 * from `packages/audit`, `feature_flag` from `packages/feature-flags`).
 */

import sqlFamily from '@prisma-next/family-sql/pack';
import { defineContract } from '@prisma-next/sql-contract-ts/contract-builder';
import postgresPack from '@prisma-next/target-postgres/pack';

export const APP_USER_TABLE = 'app_user' as const;

export const contract = defineContract(
  {
    family: sqlFamily,
    target: postgresPack,
  },
  ({ field, model }) => ({
    models: {
      User: model('User', {
        fields: {
          id: field.text().id(),
          email: field.text(),
        },
      }).sql({
        table: APP_USER_TABLE,
      }),
    },
  }),
);

export default contract;
