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

/**
 * `pg_type`-existence postcheck for an object the bundle SQL creates
 * inside the `eql_v2` schema. The structural op runs after
 * `install-eql-bundle`, so the type must already be present.
 */
function typeExistsInEqlV2(typname: string) {
  return {
    description: `verify "eql_v2.${typname}" type exists`,
    sql: `SELECT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'eql_v2' AND t.typname = '${typname}')`,
  };
}

interface StructuralOp {
  readonly id: string;
  readonly label: string;
  readonly invariantId: string;
  readonly postcheck: { readonly description: string; readonly sql: string };
}

/**
 * Structural verification ops. Each registers an invariantId for one
 * typed object the bundle SQL installs in the `eql_v2` schema, and
 * postcheck-verifies that object is reachable through `pg_type`.
 * `execute` is empty: the bundle SQL has already created the object.
 */
const STRUCTURAL_OPS: readonly StructuralOp[] = [
  {
    id: 'cipherstash.create-eql_v2_blake3',
    label: 'Register eql_v2.blake3 domain',
    invariantId: CIPHERSTASH_INVARIANTS.createBlake3,
    postcheck: typeExistsInEqlV2('blake3'),
  },
  {
    id: 'cipherstash.create-eql_v2_bloom_filter',
    label: 'Register eql_v2.bloom_filter domain',
    invariantId: CIPHERSTASH_INVARIANTS.createBloomFilter,
    postcheck: typeExistsInEqlV2('bloom_filter'),
  },
  {
    id: 'cipherstash.create-eql_v2_configuration',
    label: 'Register public.eql_v2_configuration table',
    invariantId: CIPHERSTASH_INVARIANTS.createConfiguration,
    postcheck: {
      description: 'verify "public.eql_v2_configuration" table exists',
      sql: "SELECT to_regclass('public.eql_v2_configuration') IS NOT NULL",
    },
  },
  {
    id: 'cipherstash.create-eql_v2_configuration_state',
    label: 'Register eql_v2.eql_v2_configuration_state enum',
    invariantId: CIPHERSTASH_INVARIANTS.createConfigurationState,
    postcheck: typeExistsInEqlV2('eql_v2_configuration_state'),
  },
  {
    id: 'cipherstash.create-eql_v2_encrypted',
    label: 'Register eql_v2.eql_v2_encrypted composite type',
    invariantId: CIPHERSTASH_INVARIANTS.createEncrypted,
    postcheck: typeExistsInEqlV2('eql_v2_encrypted'),
  },
  {
    id: 'cipherstash.create-eql_v2_hmac_256',
    label: 'Register eql_v2.hmac_256 domain',
    invariantId: CIPHERSTASH_INVARIANTS.createHmac256,
    postcheck: typeExistsInEqlV2('hmac_256'),
  },
  {
    id: 'cipherstash.create-eql_v2_ore_block_u64_8_256',
    label: 'Register eql_v2.ore_block_u64_8_256 composite type',
    invariantId: CIPHERSTASH_INVARIANTS.createOreBlockU64_8_256,
    postcheck: typeExistsInEqlV2('ore_block_u64_8_256'),
  },
  {
    id: 'cipherstash.create-eql_v2_ore_block_u64_8_256_term',
    label: 'Register eql_v2.ore_block_u64_8_256_term composite type',
    invariantId: CIPHERSTASH_INVARIANTS.createOreBlockU64_8_256Term,
    postcheck: typeExistsInEqlV2('ore_block_u64_8_256_term'),
  },
  {
    id: 'cipherstash.create-eql_v2_ore_cllw_u64_8',
    label: 'Register eql_v2.ore_cllw_u64_8 composite type',
    invariantId: CIPHERSTASH_INVARIANTS.createOreCllwU64_8,
    postcheck: typeExistsInEqlV2('ore_cllw_u64_8'),
  },
  {
    id: 'cipherstash.create-eql_v2_ore_cllw_var_8',
    label: 'Register eql_v2.ore_cllw_var_8 composite type',
    invariantId: CIPHERSTASH_INVARIANTS.createOreCllwVar8,
    postcheck: typeExistsInEqlV2('ore_cllw_var_8'),
  },
];

export default class M extends Migration {
  override describe() {
    return {
      from: null,
      to: 'sha256:efa685171bebbb8f078f08d12be3578bb5d96b71669dccc6cc9e4be96af8cdb4',
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
          typeExistsInEqlV2('eql_v2_encrypted'),
        ],
      }),
      ...STRUCTURAL_OPS.map((op) =>
        rawSql({
          id: op.id,
          label: op.label,
          operationClass: 'additive',
          invariantId: op.invariantId,
          target: { id: 'postgres' },
          precheck: [],
          execute: [],
          postcheck: [op.postcheck],
        }),
      ),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
