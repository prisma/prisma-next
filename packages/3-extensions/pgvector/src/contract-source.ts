/**
 * TS contract source for the `extension-pgvector` package.
 *
 * Authored against the on-disk-in-package convention (TML-2397). The
 * same emit pipeline application authors use is applied here:
 *
 *   `prisma-next contract emit` → `<package>/contract.{json,d.ts}`
 *   `prisma-next migration plan` → `<package>/migrations/pgvector/<dirName>/`
 *
 * The descriptor at `src/exports/control.ts` then wires the emitted
 * JSON artefacts via JSON-import declarations.
 *
 * ## IR coverage
 *
 * pgvector ships **no tables** of its own. The single object the
 * extension contributes to the contract IR is the parameterised native
 * type `vector(N)`, registered under `storage.types`. Per-column
 * instances on the user's side carry concrete `typeParams.length`
 * (e.g. `vector(1536)`); the registration here declares the
 * parameterised shape so the verifier sees `vector` as part of
 * pgvector's space contribution and so the pinned `contract.json` on
 * disk is materially distinct from an empty space.
 *
 * Unlike CipherStash's deferred typed objects (composite types /
 * domains / enums — IR vocabulary deferral, see
 * `packages/3-extensions/cipherstash/src/contract-source.ts`),
 * pgvector's `vector` IS representable in today's IR via
 * {@link StorageTypeInstance}.
 *
 * @see docs/architecture docs/adrs/ADR 212 - Contract spaces.md
 */

import sqlFamily from '@prisma-next/family-sql/pack';
import { defineContract } from '@prisma-next/sql-contract-ts/contract-builder';
import postgresPack from '@prisma-next/target-postgres/pack';
import { VECTOR_CODEC_ID } from './core/constants';
import { PGVECTOR_NATIVE_TYPE } from './core/contract-space-constants';

export const contract = defineContract(
  {
    family: sqlFamily,
    target: postgresPack,
  },
  () => ({
    types: {
      [PGVECTOR_NATIVE_TYPE]: {
        codecId: VECTOR_CODEC_ID,
        nativeType: PGVECTOR_NATIVE_TYPE,
        typeParams: {},
      },
    },
    models: {},
  }),
);

export default contract;
