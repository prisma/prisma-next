#!/usr/bin/env -S node
/**
 * CipherStash baseline migration — install the vendored EQL bundle.
 *
 * The contract IR (see `<package>/contract.json`) declares the
 * `eql_v2_configuration` table only — that's the single typed object
 * today's `SqlStorage` IR can model. The actual database state — the
 * `eql_v2` schema, the `eql_v2_configuration_state` enum, the
 * `eql_v2_encrypted` composite, the `eql_v2.bloom_filter` /
 * `hmac_256` / `blake3` domains, plus the ORE composites — is created
 * by the vendored EQL bundle SQL (see `../../src/migration/eql-bundle.ts`,
 * which re-exports the bundle from `eql-install.generated.ts`
 * byte-for-byte). The bundle also creates the `eql_v2_configuration`
 * table itself, so the planner-emitted
 * `createTable` op would conflict with the bundle's `CREATE TABLE`
 * and is intentionally dropped from this migration's `operations`
 * getter.
 *
 * Authoring loop: this file is hand-edited (see
 * `docs/architecture docs/adrs/ADR 212 - Contract spaces.md`'s
 * contract-space package layout section). Re-emit `ops.json` /
 * `migration.json` after edits via `node migration.ts`.
 */
import { Migration, MigrationCLI, rawSql } from '@prisma-next/target-postgres/migration';
import { CIPHERSTASH_INVARIANTS } from '../../src/extension-metadata/constants';
import { EQL_BUNDLE_SQL } from '../../src/migration/eql-bundle';

const INSTALL_LABEL = 'Install EQL bundle (functions, operators, casts, op classes, schema, types)';

export default class M extends Migration {
  override describe() {
    return {
      from: null,
      to: 'sha256:1d80ee12f4dcc582393f331c89a7a691866d5071348009e7caff9c6c5b1880f2',
    };
  }

  override get operations() {
    return [
      rawSql({
        id: 'cipherstash.install-eql-bundle',
        label: INSTALL_LABEL,
        operationClass: 'additive',
        invariantId: CIPHERSTASH_INVARIANTS.installBundle,
        target: { id: 'postgres' },
        precheck: [],
        execute: [{ description: INSTALL_LABEL, sql: EQL_BUNDLE_SQL }],
        postcheck: [
          {
            description: 'verify "eql_v2" schema exists',
            sql: "SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'eql_v2')",
          },
          {
            description: 'verify "eql_v2.eql_v2_encrypted" composite type exists',
            sql: "SELECT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'eql_v2' AND t.typname = 'eql_v2_encrypted')",
          },
        ],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
