/** Internal audit contract-space source. See ../README.md for the emit + migration-authoring workflow. */

import sqlFamily from '@prisma-next/family-sql/pack';
import { defineContract } from '@prisma-next/sql-contract-ts/contract-builder';
import postgresPack from '@prisma-next/target-postgres/pack';
import { AUDIT_EVENT_TABLE } from './constants';

export const contract = defineContract(
  {
    family: sqlFamily,
    target: postgresPack,
  },
  ({ field, model }) => ({
    models: {
      AuditEvent: model('AuditEvent', {
        fields: {
          id: field.text().id(),
          actor: field.text(),
          action: field.text(),
        },
      }).sql({
        table: AUDIT_EVENT_TABLE,
      }),
    },
  }),
);

export default contract;
