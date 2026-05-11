/**
 * TS contract source for the `extension-paradedb` package.
 *
 * Authored against the on-disk-in-package convention. The same emit
 * pipeline application authors use is applied here:
 *
 *   `prisma-next contract emit` → `<package>/contract.{json,d.ts}`
 *   `prisma-next migration plan` → `<package>/migrations/paradedb/<dirName>/`
 *
 * The descriptor at `src/exports/control.ts` then wires the emitted
 * JSON artefacts via JSON-import declarations.
 *
 * ## IR coverage
 *
 * paradedb ships **no tables** and **no native types** of its own. Its
 * baseline migration installs the `pg_search` Postgres extension; all
 * BM25 index configuration is carried by the user contract's own models
 * (via the `'bm25'` index-type entry registered in `src/types/index-types.ts`).
 * The contract IR here is therefore minimal — an empty `models` map —
 * but the space is still required so the migration runner can track
 * the `pg_search` installation invariant independently of any user models.
 *
 * @see docs/architecture docs/adrs/ADR 212 - Contract spaces.md
 */

import sqlFamily from '@prisma-next/family-sql/pack';
import { defineContract } from '@prisma-next/sql-contract-ts/contract-builder';
import postgresPack from '@prisma-next/target-postgres/pack';

export const contract = defineContract(
  {
    family: sqlFamily,
    target: postgresPack,
  },
  () => ({
    models: {},
  }),
);

export default contract;
