/**
 * CipherStash contract space — baseline migration package.
 *
 * Per project spec FR1, an extension's `contractSpace.migrations` is a
 * list of {@link MigrationPackage} values whose `ops` carry framework-
 * level `MigrationPlanOperation`s. The SQL family runner reads the additional
 * runtime fields (`target`, `precheck`, `execute`, `postcheck`) at
 * apply time; the manifest schema on disk (`ops.json`) intentionally
 * stays light at the framework level.
 *
 * R1 ships a single baseline migration whose ops mirror the M3 sub-spec
 * § 3 table: one `installEqlBundle` op carrying the vendored EQL bundle
 * SQL byte-for-byte (placeholder content for now — see
 * `./eql-bundle.ts`), one structural op per typed object in CipherStash's
 * contract IR, plus structural ops for the typed objects deferred to
 * IR-vocabulary expansion (composite types / enum / domains — kept here
 * so the database state remains consistent with the
 * `meta.cipherstashFutureIR` documentation in `./contract.ts`).
 *
 * Each op carries a stable `cipherstash:*` invariantId — once published
 * these ids are immutable (project spec FR11).
 */

import type {
  ExtensionContractRef,
  SqlMigrationPlanOperation,
} from '@prisma-next/family-sql/control';
import type { MigrationPlanOperation } from '@prisma-next/framework-components/control';
import { computeMigrationHash } from '@prisma-next/migration-tools/hash';
import type { MigrationPackage } from '@prisma-next/migration-tools/package';
import {
  CIPHERSTASH_BASELINE_MIGRATION_NAME,
  CIPHERSTASH_INVARIANTS,
  EQL_V2_CONFIGURATION_STATE_TYPE,
  EQL_V2_CONFIGURATION_TABLE,
  EQL_V2_DOMAIN_TYPES,
  EQL_V2_ENCRYPTED_TYPE,
  EQL_V2_ORE_COMPOSITE_TYPES,
  EQL_V2_SCHEMA,
} from './constants';
import { CIPHERSTASH_STORAGE_HASH, cipherstashContract } from './contract';
import { EQL_BUNDLE_SQL } from './eql-bundle';

/**
 * Postgres-style `target.details` shape the SQL runner consumes when
 * executing extension-space ops. CipherStash targets only Postgres
 * (the EQL bundle is Postgres-specific); locking the target id here
 * keeps the per-op `target` literal narrow without coupling to the
 * Postgres adapter package's `PostgresPlanTargetDetails`.
 */
type PostgresTargetDetails = {
  readonly schema: string;
  readonly objectType: 'table' | 'type' | 'domain' | 'enum' | 'extension';
  readonly name: string;
};

/**
 * Build a runtime SQL op as `SqlMigrationPlanOperation<unknown>` first
 * (so we get the structural `target`/`precheck`/`execute`/`postcheck`
 * shape checked by the type system), then narrow the
 * `target.details` to {@link PostgresTargetDetails} via a single
 * scoped cast on `target.details`. The wider `MigrationOps` type that
 * {@link MigrationPackage}'s `ops` declares is `readonly
 * MigrationPlanOperation[]` (sub-spec § 1, AM3) — the SQL runner reads
 * the runtime fields off the same object at execution time.
 *
 * @see packages/3-targets/6-adapters/sqlite/test/migrations/db-apply-per-space.cli.test.ts
 *   for the same authoring pattern at the SQLite test fixture site.
 */
function makeOp(args: {
  id: string;
  label: string;
  invariantId: string;
  target: PostgresTargetDetails;
  executeSql: string;
}): SqlMigrationPlanOperation<unknown> {
  return {
    id: args.id,
    label: args.label,
    operationClass: 'additive',
    invariantId: args.invariantId,
    target: { id: 'postgres', details: args.target },
    precheck: [],
    execute: [{ description: args.label, sql: args.executeSql }],
    postcheck: [],
  };
}

/**
 * SQL body the structural `cipherstash:create-*-v1` ops run.
 *
 * The vendored EQL bundle (executed by `installEqlBundleOp`) creates
 * every typed object CipherStash needs (the `eql_v2` schema, the
 * `eql_v2_configuration` table in `public`, the
 * `eql_v2_configuration_state` enum, the `eql_v2_encrypted` composite,
 * the `eql_v2.bloom_filter` / `hmac_256` / `blake3` domains, and the
 * `ore_*` composites). The structural ops that follow it would
 * therefore *conflict* with the bundle's CREATEs if they ran any
 * concrete DDL — Postgres rejects duplicate `CREATE TYPE` /
 * `CREATE TABLE` against the same name.
 *
 * Resolution (M3 R3 — sub-spec § 3 amendment): the structural ops
 * keep their stable `cipherstash:*` invariantIds (so the marker's
 * `applied_invariants` matches `cipherstashHeadRef.invariants` and the
 * verifier's `invariantsMismatch` gate passes) but their `execute[]`
 * is a no-op `SELECT 1`. The bundle owns the typed-object DDL; the
 * structural ops own the invariantId ledger entry. Clean separation:
 *
 *   - Adding a new typed object = add to `installEqlBundleOp`'s SQL
 *     (via a vendored-bundle bump) **and** mint a new
 *     `cipherstash:create-<name>-v1` structural op here, with this
 *     same no-op body.
 *   - Removing a typed object = remove from the bundle bump, and
 *     deprecate the structural op (its invariantId is immutable per
 *     project spec FR11; deprecation is a future-rounds concern).
 *
 * Future extension (deferred to IR vocabulary expansion — see
 * `./contract.ts`'s `cipherstashFutureIR` block): once the IR models
 * enums / composite types / domains as first-class storage objects,
 * the structural ops will gain real verification work and `precheck`
 * SQL that probes `pg_type` / `information_schema` for the typed
 * object's existence. Today they are pure ledger-only entries.
 */
const STRUCTURAL_OP_NOOP_SQL = 'SELECT 1';

const installEqlBundleOp = makeOp({
  id: 'cipherstash.install-eql-bundle',
  label: 'Install EQL bundle (functions, operators, casts, op classes, schema, types)',
  invariantId: CIPHERSTASH_INVARIANTS.installBundle,
  target: { schema: EQL_V2_SCHEMA, objectType: 'extension', name: 'eql_v2' },
  executeSql: EQL_BUNDLE_SQL,
});

const createConfigurationStateEnumOp = makeOp({
  id: `cipherstash.create-${EQL_V2_CONFIGURATION_STATE_TYPE}`,
  label: `Register invariant for enum ${EQL_V2_CONFIGURATION_STATE_TYPE} (created by EQL bundle)`,
  invariantId: CIPHERSTASH_INVARIANTS.createConfigurationState,
  target: { schema: 'public', objectType: 'enum', name: EQL_V2_CONFIGURATION_STATE_TYPE },
  executeSql: STRUCTURAL_OP_NOOP_SQL,
});

const createConfigurationTableOp = makeOp({
  id: `cipherstash.create-${EQL_V2_CONFIGURATION_TABLE}`,
  label: `Register invariant for table ${EQL_V2_CONFIGURATION_TABLE} (created by EQL bundle)`,
  invariantId: CIPHERSTASH_INVARIANTS.createConfiguration,
  target: { schema: 'public', objectType: 'table', name: EQL_V2_CONFIGURATION_TABLE },
  executeSql: STRUCTURAL_OP_NOOP_SQL,
});

const createEncryptedCompositeOp = makeOp({
  id: `cipherstash.create-${EQL_V2_ENCRYPTED_TYPE}`,
  label: `Register invariant for composite type ${EQL_V2_ENCRYPTED_TYPE} (created by EQL bundle)`,
  invariantId: CIPHERSTASH_INVARIANTS.createEncrypted,
  target: { schema: 'public', objectType: 'type', name: EQL_V2_ENCRYPTED_TYPE },
  executeSql: STRUCTURAL_OP_NOOP_SQL,
});

const createDomainOps = EQL_V2_DOMAIN_TYPES.map((name) =>
  makeOp({
    id: `cipherstash.create-${EQL_V2_SCHEMA}-${name}`,
    label: `Register invariant for domain ${EQL_V2_SCHEMA}.${name} (created by EQL bundle)`,
    invariantId: CIPHERSTASH_INVARIANTS.createDomain(name),
    target: { schema: EQL_V2_SCHEMA, objectType: 'domain', name },
    executeSql: STRUCTURAL_OP_NOOP_SQL,
  }),
);

const createOreCompositeOps = EQL_V2_ORE_COMPOSITE_TYPES.map((name) =>
  makeOp({
    id: `cipherstash.create-${EQL_V2_SCHEMA}-${name}`,
    label: `Register invariant for composite type ${EQL_V2_SCHEMA}.${name} (created by EQL bundle)`,
    invariantId: CIPHERSTASH_INVARIANTS.createOreComposite(name),
    target: { schema: EQL_V2_SCHEMA, objectType: 'type', name },
    executeSql: STRUCTURAL_OP_NOOP_SQL,
  }),
);

/**
 * Ordered op list. `installEqlBundleOp` runs first and creates every
 * typed object CipherStash needs. The structural `create-*` ops that
 * follow are no-ops at the database level (`SELECT 1`) and exist
 * purely to register their `cipherstash:*` invariantIds against the
 * marker — see the {@link STRUCTURAL_OP_NOOP_SQL} block above for the
 * conflict-resolution rationale.
 *
 * The framework's {@link MigrationPackage} `ops` type is
 * `readonly MigrationPlanOperation[]` — wider than the SQL-family
 * runtime op shape. The list is typed as the framework alias here and
 * the runner narrows back to the SQL shape at apply time.
 */
const cipherstashBaselineOps: readonly MigrationPlanOperation[] = [
  installEqlBundleOp,
  createConfigurationStateEnumOp,
  createConfigurationTableOp,
  createEncryptedCompositeOp,
  ...createDomainOps,
  ...createOreCompositeOps,
];

/** Sorted list of invariantIds the baseline migration provides. */
export const CIPHERSTASH_BASELINE_INVARIANTS: readonly string[] = (() => {
  const ids = cipherstashBaselineOps
    .map((op) => op.invariantId)
    .filter((id): id is string => typeof id === 'string');
  return [...new Set(ids)].sort();
})();

const baselineMetadataWithoutHash: Omit<MigrationPackage['metadata'], 'migrationHash'> = {
  from: null,
  to: CIPHERSTASH_STORAGE_HASH,
  fromContract: null,
  toContract: cipherstashContract,
  hints: { used: [], applied: [], plannerVersion: '2.0.0' },
  labels: [],
  providedInvariants: CIPHERSTASH_BASELINE_INVARIANTS,
  createdAt: '2026-06-01T00:00:00.000Z',
};

/**
 * Baseline migration package the descriptor publishes via
 * `contractSpace.migrations`. The framework's emitter (T1.7) writes
 * this to `migrations/cipherstash/<dirName>/{manifest,ops,contract}.json`
 * in the user's repo at `migrate` time.
 *
 * `dirPath` is set to a synthetic relative value (the dirName itself).
 * This is in-memory authoring — the package has not yet been written to
 * disk by the consuming application, so there is no real on-disk path.
 * The on-disk-in-package authoring convention (M3.5) supersedes this
 * shape; cipherstash will migrate to it in M3.5 R2.
 */
export const cipherstashBaselineMigration: MigrationPackage = {
  dirName: CIPHERSTASH_BASELINE_MIGRATION_NAME,
  dirPath: CIPHERSTASH_BASELINE_MIGRATION_NAME,
  metadata: {
    ...baselineMetadataWithoutHash,
    migrationHash: computeMigrationHash(baselineMetadataWithoutHash, cipherstashBaselineOps),
  },
  ops: cipherstashBaselineOps,
};

/**
 * Pinned head ref the descriptor publishes. The framework writes this
 * verbatim to `migrations/cipherstash/refs/head.json` (with `invariants`
 * sorted alphabetically per the canonicalisation rules); the runner's
 * `findPathWithDecision` step (T2.3 / T2.4) consults `head.json` to
 * decide which migrations need to apply.
 */
export const cipherstashHeadRef: ExtensionContractRef = {
  hash: CIPHERSTASH_STORAGE_HASH,
  invariants: CIPHERSTASH_BASELINE_INVARIANTS,
};
