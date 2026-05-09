/**
 * TS contract source for the synthetic `test-contract-space` extension.
 *
 * This package is the **on-disk-in-package** reference model for the
 * extension-authoring convention introduced by M3.5 (project:
 * extension-contract-spaces, TML-2397). It uses the same emit pipeline
 * application authors use:
 *
 *   `prisma-next contract emit` → `<package>/contract.{json,d.ts}`
 *   `prisma-next migration plan` → `<package>/migrations/<space-id>/<dirName>/`
 *
 * The descriptor at `src/exports/control.ts` then wires those JSON
 * artefacts via JSON-import declarations, synthesising the framework's
 * canonical {@link import('@prisma-next/migration-tools/package').MigrationPackage}
 * shape (with `dirPath` resolved from `import.meta.url`).
 *
 * Future R2 + R3 rounds (cipherstash / pgvector / multi-extension-monorepo)
 * mirror this convention.
 *
 * @see docs/architecture docs/adrs/ADR 211 - Contract spaces.md
 */

import sqlFamily from '@prisma-next/family-sql/pack';
import { defineContract } from '@prisma-next/sql-contract-ts/contract-builder';
import postgresPack from '@prisma-next/target-postgres/pack';

export const contract = defineContract(
  {
    family: sqlFamily,
    target: postgresPack,
  },
  ({ field, model }) => ({
    models: {
      TestBox: model('TestBox', {
        fields: {
          x: field.int(),
          y: field.int(),
        },
      }).sql({ table: 'test_box' }),
    },
  }),
);

export default contract;
