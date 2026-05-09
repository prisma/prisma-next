#!/usr/bin/env -S node
/**
 * CipherStash baseline migration — install EQL bundle + register
 * invariantIds for typed objects the bundle creates.
 *
 * The contract IR (see `<package>/contract.json`) declares the
 * `eql_v2_configuration` table only — that's the single typed object
 * today's `SqlStorage` IR can model. The actual database state — the
 * `eql_v2` schema, the `eql_v2_configuration_state` enum, the
 * `eql_v2_encrypted` composite, the `eql_v2.bloom_filter` /
 * `hmac_256` / `blake3` domains, plus the ORE composites — is created
 * by the vendored EQL bundle SQL (see
 * `../../../src/core/eql-bundle.ts`, which re-exports the bundle from
 * `eql-install.generated.ts` byte-for-byte per project spec NFR4 /
 * AC7). The bundle also creates the `eql_v2_configuration` table
 * itself, so the planner-emitted `createTable` op would conflict with
 * the bundle's `CREATE TABLE` and is intentionally dropped from this
 * migration's `operations` getter.
 *
 * The structural `cipherstash:create-*-v1` ops that follow the bundle
 * carry stable invariantIds (per project spec FR11 — once published,
 * an invariantId cannot be renamed) but their `execute[]` is a no-op
 * `SELECT 1`. They exist purely to register the invariantId ledger
 * entries the verifier matches against `cipherstashHeadRef.invariants`
 * — the bundle owns the actual DDL. Once the IR vocabulary expands
 * (FR9 deferral, see `../../../src/contract-source.ts`), the
 * structural ops will gain real precheck SQL and the bundle's typed
 * objects will appear in `storage` / `storage.types`.
 *
 * Authoring loop: this file is hand-edited (M3.5 Path A — see
 * `docs/architecture docs/adrs/ADR 211 - Contract spaces.md`'s
 * on-disk-in-package authoring section). Re-emit `ops.json` /
 * `migration.json` after edits via `node migration.ts`.
 */
import { Migration, MigrationCLI, rawSql } from '@prisma-next/target-postgres/migration';
import {
  CIPHERSTASH_INVARIANTS,
  EQL_V2_CONFIGURATION_STATE_TYPE,
  EQL_V2_CONFIGURATION_TABLE,
  EQL_V2_DOMAIN_TYPES,
  EQL_V2_ENCRYPTED_TYPE,
  EQL_V2_ORE_COMPOSITE_TYPES,
  EQL_V2_SCHEMA,
} from '../../../src/core/constants';
import { EQL_BUNDLE_SQL } from '../../../src/core/eql-bundle';

const STRUCTURAL_OP_NOOP_SQL = 'SELECT 1';

interface MakeOpArgs {
  readonly id: string;
  readonly label: string;
  readonly invariantId: string;
  readonly executeSql: string;
}

function makeOp(args: MakeOpArgs) {
  return rawSql({
    id: args.id,
    label: args.label,
    operationClass: 'additive',
    invariantId: args.invariantId,
    target: { id: 'postgres' },
    precheck: [],
    execute: [{ description: args.label, sql: args.executeSql }],
    postcheck: [],
  });
}

export default class M extends Migration {
  override describe() {
    return {
      from: null,
      to: 'sha256:efa685171bebbb8f078f08d12be3578bb5d96b71669dccc6cc9e4be96af8cdb4',
    };
  }

  override get operations() {
    return [
      makeOp({
        id: 'cipherstash.install-eql-bundle',
        label: 'Install EQL bundle (functions, operators, casts, op classes, schema, types)',
        invariantId: CIPHERSTASH_INVARIANTS.installBundle,
        executeSql: EQL_BUNDLE_SQL,
      }),
      makeOp({
        id: `cipherstash.create-${EQL_V2_CONFIGURATION_STATE_TYPE}`,
        label: `Register invariant for enum ${EQL_V2_CONFIGURATION_STATE_TYPE} (created by EQL bundle)`,
        invariantId: CIPHERSTASH_INVARIANTS.createConfigurationState,
        executeSql: STRUCTURAL_OP_NOOP_SQL,
      }),
      makeOp({
        id: `cipherstash.create-${EQL_V2_CONFIGURATION_TABLE}`,
        label: `Register invariant for table ${EQL_V2_CONFIGURATION_TABLE} (created by EQL bundle)`,
        invariantId: CIPHERSTASH_INVARIANTS.createConfiguration,
        executeSql: STRUCTURAL_OP_NOOP_SQL,
      }),
      makeOp({
        id: `cipherstash.create-${EQL_V2_ENCRYPTED_TYPE}`,
        label: `Register invariant for composite type ${EQL_V2_ENCRYPTED_TYPE} (created by EQL bundle)`,
        invariantId: CIPHERSTASH_INVARIANTS.createEncrypted,
        executeSql: STRUCTURAL_OP_NOOP_SQL,
      }),
      ...EQL_V2_DOMAIN_TYPES.map((name) =>
        makeOp({
          id: `cipherstash.create-${EQL_V2_SCHEMA}-${name}`,
          label: `Register invariant for domain ${EQL_V2_SCHEMA}.${name} (created by EQL bundle)`,
          invariantId: CIPHERSTASH_INVARIANTS.createDomain(name),
          executeSql: STRUCTURAL_OP_NOOP_SQL,
        }),
      ),
      ...EQL_V2_ORE_COMPOSITE_TYPES.map((name) =>
        makeOp({
          id: `cipherstash.create-${EQL_V2_SCHEMA}-${name}`,
          label: `Register invariant for composite type ${EQL_V2_SCHEMA}.${name} (created by EQL bundle)`,
          invariantId: CIPHERSTASH_INVARIANTS.createOreComposite(name),
          executeSql: STRUCTURAL_OP_NOOP_SQL,
        }),
      ),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
