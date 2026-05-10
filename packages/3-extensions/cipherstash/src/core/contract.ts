/**
 * CipherStash contract space — the typed objects EQL exposes that user
 * columns can name as `nativeType`.
 *
 * ## IR coverage and explicit deferral
 *
 * CipherStash installs four kinds of typed objects: tables, enums,
 * composite types, and domains. The current `SqlStorage` IR
 * (`@prisma-next/sql-contract/types`) only models tables (`StorageTable`)
 * and parameterised type instances (`StorageTypeInstance`, which is
 * `{ codecId, nativeType, typeParams }` — a fit for things like pgvector's
 * `vector(N)`, but not for codec-less composite types, standalone enums,
 * or domains).
 *
 * This module declares the only IR-representable object today —
 * `eql_v2_configuration` — and records the remaining typed objects under
 * `meta.cipherstashFutureIR` as a documentary placeholder. Those objects
 * are still **created in the database** by the `installEqlBundle`
 * migration op (which carries the vendored bundle SQL byte-for-byte —
 * see `./eql-bundle`), so the runtime contract holds; the gap is purely
 * the verifier's structural visibility of those typed objects until IR
 * vocabulary expansion lands.
 */

import { computeStorageHash } from '@prisma-next/contract/hashing';
import { type Contract, coreHash, profileHash } from '@prisma-next/contract/types';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import {
  EQL_V2_CONFIGURATION_STATE_TYPE,
  EQL_V2_CONFIGURATION_TABLE,
  EQL_V2_DOMAIN_TYPES,
  EQL_V2_ENCRYPTED_TYPE,
  EQL_V2_ORE_COMPOSITE_TYPES,
  EQL_V2_SCHEMA,
} from './constants';

const TARGET = 'postgres' as const;
const TARGET_FAMILY = 'sql' as const;

/**
 * Storage body for the contract — the canonical `(tables, types?)`
 * vocabulary the SQL contract IR currently supports. CipherStash's only
 * IR-representable object today is the `eql_v2_configuration` table;
 * everything else CipherStash installs lives in the migration op
 * payload (see deferral rationale at the top of this file).
 *
 * Authored without `storageHash` here so {@link computeStorageHash} can
 * digest the canonical body (the hashing pipeline panics if asked to
 * hash an object that already carries its own output — see
 * `assertDescriptorSelfConsistency`'s storage-hash strip).
 */
const storageBody = {
  tables: {
    [EQL_V2_CONFIGURATION_TABLE]: {
      columns: {
        id: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
        state: {
          codecId: 'pg/text@1',
          nativeType: EQL_V2_CONFIGURATION_STATE_TYPE,
          nullable: false,
        },
        data: { codecId: 'pg/jsonb@1', nativeType: 'jsonb', nullable: false },
      },
      primaryKey: { columns: ['id'] },
      uniques: [],
      indexes: [],
      foreignKeys: [],
    },
  },
};

/**
 * Documentary placeholder for the typed objects CipherStash would
 * declare in contract IR if the vocabulary supported them. Lives under
 * the contract's free-form `meta` so it does not perturb any framework
 * pipeline (planner / runner / verifier ignore unknown `meta` keys),
 * yet remains discoverable to anyone reading the emitted
 * `contract.json`.
 *
 * The shape mirrors the table format in M3 sub-spec § 2; once the IR
 * gains first-class enum / composite / domain support, this block
 * shifts up into `storage` and the migration ops that create them
 * follow today's `cipherstash:create-*-v1` invariantId convention.
 */
const cipherstashFutureIR = {
  /** Composite types (will move to `storage.compositeTypes` post-IR-expansion). */
  compositeTypes: [
    { schema: null, name: EQL_V2_ENCRYPTED_TYPE },
    ...EQL_V2_ORE_COMPOSITE_TYPES.map((name) => ({ schema: EQL_V2_SCHEMA, name })),
  ],
  /**
   * Enum types (will move to `storage.enums` post-IR-expansion). The
   * value list mirrors the vendored EQL bundle's
   * `CREATE TYPE public.eql_v2_configuration_state AS ENUM (...)`
   * declaration verbatim — synced in M3 R4 (item 22).
   */
  enums: [
    {
      schema: null,
      name: EQL_V2_CONFIGURATION_STATE_TYPE,
      values: ['active', 'inactive', 'encrypting', 'pending'],
    },
  ],
  /** Domain types (will move to `storage.domains` post-IR-expansion). */
  domains: EQL_V2_DOMAIN_TYPES.map((name) => ({ schema: EQL_V2_SCHEMA, name })),
} as const;

/** Content-addressed hash of CipherStash's storage IR. */
export const CIPHERSTASH_STORAGE_HASH = computeStorageHash({
  target: TARGET,
  targetFamily: TARGET_FAMILY,
  storage: storageBody,
});

/** CipherStash's contract value, exposed via the descriptor's `contractSpace.contractJson`. */
export const cipherstashContract: Contract<SqlStorage> = {
  target: TARGET,
  targetFamily: TARGET_FAMILY,
  roots: {},
  models: {},
  capabilities: {},
  extensionPacks: {},
  meta: { cipherstashFutureIR },
  profileHash: profileHash('cipherstash-extension-profile-v1'),
  storage: {
    ...storageBody,
    storageHash: coreHash(CIPHERSTASH_STORAGE_HASH),
  },
};
