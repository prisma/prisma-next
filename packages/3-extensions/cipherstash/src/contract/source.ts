/**
 * TS contract source for the `extension-cipherstash` package.
 *
 * Authored against the on-disk-in-package convention introduced in M3.5
 * R1 (project: extension-contract-spaces, TML-2397). The same emit
 * pipeline application authors use is applied here:
 *
 *   `prisma-next contract emit` → `<package>/contract.{json,d.ts}`
 *   `prisma-next migration plan` → `<package>/migrations/cipherstash/<dirName>/`
 *
 * The descriptor at `src/exports/control.ts` then wires the emitted JSON
 * artefacts via JSON-import declarations.
 *
 * ## R2 IR coverage and explicit deferral
 *
 * The project spec lists four kinds of typed objects CipherStash should
 * declare in its contract IR: tables, enums, composite types, and
 * domains (project spec FR9 / AC8; M3 sub-spec § 2). Of these, today's
 * `SqlStorage` IR (`@prisma-next/sql-contract/types`) only models tables
 * and parameterised type instances (a fit for things like pgvector's
 * `vector(N)`, but not yet codec-less composite types, standalone
 * enums, or domains).
 *
 * R2 declares the only IR-representable object today (the
 * `eql_v2_configuration` table) using portable column types
 * (`field.text()` / `field.json()`). The actual database state — the
 * `eql_v2` schema, the typed `eql_v2_configuration_state` enum, the
 * `eql_v2_encrypted` composite, the `eql_v2.bloom_filter` / `hmac_256`
 * / `blake3` domains, and the various `ore_*` composites — is created
 * by the `installEqlBundle` migration op (which carries the vendored
 * bundle SQL byte-for-byte; see `./migration/eql-bundle.ts`). The
 * structural `cipherstash:create-*-v1` no-op ops register the
 * invariantIds the verifier needs so its `applied_invariants` gate
 * passes.
 *
 * Once the IR vocabulary expands to first-class composite types,
 * standalone enums, and domains, those typed objects shift up into
 * `storage.types` and the structural ops gain real verification work
 * (precheck SQL probing `pg_type` / `information_schema`).
 *
 * @see docs/architecture docs/adrs/ADR 211 - Contract spaces.md
 */

import sqlFamily from '@prisma-next/family-sql/pack';
import { defineContract } from '@prisma-next/sql-contract-ts/contract-builder';
import postgresPack from '@prisma-next/target-postgres/pack';
import { EQL_V2_CONFIGURATION_TABLE } from '../extension-metadata/constants';

export const contract = defineContract(
  {
    family: sqlFamily,
    target: postgresPack,
  },
  ({ field, model }) => ({
    models: {
      EqlV2Configuration: model('EqlV2Configuration', {
        fields: {
          id: field.text().id(),
          state: field.text(),
          data: field.json(),
        },
      }).sql({
        table: EQL_V2_CONFIGURATION_TABLE,
      }),
    },
  }),
);

export default contract;
