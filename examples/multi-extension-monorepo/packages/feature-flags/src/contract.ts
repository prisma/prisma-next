/**
 * TS contract source for the internal `feature-flags` contract-space
 * package — see `../../audit/src/contract.ts` for the rationale and
 * authoring loop. Same shape; the duplication is intentional (each
 * "internal package" owns its own identifiers + emit pipeline).
 */

import sqlFamily from '@prisma-next/family-sql/pack';
import { defineContract } from '@prisma-next/sql-contract-ts/contract-builder';
import postgresPack from '@prisma-next/target-postgres/pack';
import { FEATURE_FLAG_TABLE } from './constants';

export const contract = defineContract(
  {
    family: sqlFamily,
    target: postgresPack,
  },
  ({ field, model }) => ({
    models: {
      FeatureFlag: model('FeatureFlag', {
        fields: {
          key: field.text().id(),
          enabled: field.boolean(),
        },
      }).sql({
        table: FEATURE_FLAG_TABLE,
      }),
    },
  }),
);

export default contract;
