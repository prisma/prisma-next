/**
 * TS contract source for the internal `audit` contract-space package.
 *
 * Authored against the on-disk-in-package convention introduced in M3.5
 * R1 (project: extension-contract-spaces, TML-2397). The same emit
 * pipeline application authors use is applied here:
 *
 *   `prisma-next contract emit` → `<package>/contract.{json,d.ts}`
 *   `prisma-next migration plan` → `<package>/migrations/audit/<dirName>/`
 *
 * The descriptor at `./control.ts` then wires the emitted JSON
 * artefacts via JSON-import declarations.
 *
 * Mirrors the cipherstash / pgvector R3 layout but lives at the
 * subdirectory root (no `src/`) because this monorepo example ships as
 * a single workspace package — see the example's `README.md` for the
 * "internal package" framing.
 */

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
