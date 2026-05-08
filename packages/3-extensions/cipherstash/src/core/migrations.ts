/**
 * CipherStash contract space — baseline migration package.
 *
 * Per project spec FR1 and the M3 sub-spec § 3, an extension's
 * `contractSpace.migrations` is a list of in-memory
 * `ExtensionMigrationPackage` values whose `ops` carry framework-level
 * `MigrationPlanOperation`s. The SQL family runner reads the additional
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
  ExtensionMigrationPackage,
  SqlMigrationPlanOperation,
} from '@prisma-next/family-sql/control';
import type { MigrationPlanOperation } from '@prisma-next/framework-components/control';
import { computeMigrationHash } from '@prisma-next/migration-tools/hash';
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
 * `ExtensionMigrationPackage.ops` declares is `readonly
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

const installEqlBundleOp = makeOp({
  id: 'cipherstash.install-eql-bundle',
  label: 'Install EQL bundle (functions, operators, casts, op classes, schema, types)',
  invariantId: CIPHERSTASH_INVARIANTS.installBundle,
  target: { schema: EQL_V2_SCHEMA, objectType: 'extension', name: 'eql_v2' },
  executeSql: EQL_BUNDLE_SQL,
});

const createConfigurationStateEnumOp = makeOp({
  id: `cipherstash.create-${EQL_V2_CONFIGURATION_STATE_TYPE}`,
  label: `Create enum ${EQL_V2_CONFIGURATION_STATE_TYPE}`,
  invariantId: CIPHERSTASH_INVARIANTS.createConfigurationState,
  target: { schema: 'public', objectType: 'enum', name: EQL_V2_CONFIGURATION_STATE_TYPE },
  executeSql: `CREATE TYPE "${EQL_V2_CONFIGURATION_STATE_TYPE}" AS ENUM ('pending', 'active')`,
});

const createConfigurationTableOp = makeOp({
  id: `cipherstash.create-${EQL_V2_CONFIGURATION_TABLE}`,
  label: `Create table ${EQL_V2_CONFIGURATION_TABLE}`,
  invariantId: CIPHERSTASH_INVARIANTS.createConfiguration,
  target: { schema: 'public', objectType: 'table', name: EQL_V2_CONFIGURATION_TABLE },
  executeSql: `CREATE TABLE "${EQL_V2_CONFIGURATION_TABLE}" (
  "id" text PRIMARY KEY,
  "state" "${EQL_V2_CONFIGURATION_STATE_TYPE}" NOT NULL,
  "data" jsonb NOT NULL
)`,
});

const createEncryptedCompositeOp = makeOp({
  id: `cipherstash.create-${EQL_V2_ENCRYPTED_TYPE}`,
  label: `Create composite type ${EQL_V2_ENCRYPTED_TYPE}`,
  invariantId: CIPHERSTASH_INVARIANTS.createEncrypted,
  target: { schema: 'public', objectType: 'type', name: EQL_V2_ENCRYPTED_TYPE },
  executeSql: `CREATE TYPE "${EQL_V2_ENCRYPTED_TYPE}" AS (data jsonb)`,
});

const createDomainOps = EQL_V2_DOMAIN_TYPES.map((name) =>
  makeOp({
    id: `cipherstash.create-${EQL_V2_SCHEMA}-${name}`,
    label: `Create domain ${EQL_V2_SCHEMA}.${name}`,
    invariantId: CIPHERSTASH_INVARIANTS.createDomain(name),
    target: { schema: EQL_V2_SCHEMA, objectType: 'domain', name },
    executeSql: `CREATE DOMAIN "${EQL_V2_SCHEMA}"."${name}" AS bytea`,
  }),
);

const createOreCompositeOps = EQL_V2_ORE_COMPOSITE_TYPES.map((name) =>
  makeOp({
    id: `cipherstash.create-${EQL_V2_SCHEMA}-${name}`,
    label: `Create composite type ${EQL_V2_SCHEMA}.${name}`,
    invariantId: CIPHERSTASH_INVARIANTS.createOreComposite(name),
    target: { schema: EQL_V2_SCHEMA, objectType: 'type', name },
    executeSql: `CREATE TYPE "${EQL_V2_SCHEMA}"."${name}" AS (payload bytea)`,
  }),
);

/**
 * Ordered op list. The `installEqlBundle` op runs first because the
 * vendored bundle creates the `eql_v2` schema, the bundle's own
 * functions/operators/casts/op classes, and (in production) most of the
 * composite/enum/domain types. The structural ops that follow are
 * idempotent-shaped (they would conflict with the bundle's CREATEs if
 * both fired against the same database) and exist to keep the manifest
 * faithful to the M3 sub-spec § 3 op list — and to give the runner an
 * explicit invariantId-keyed record of every typed object CipherStash
 * is responsible for. R2's e2e test will exercise the actual ordering
 * against a live database; R1 keeps the structural shape correct for
 * the descriptor-self-consistency and emit-cleanly checks.
 *
 * The framework's `ExtensionMigrationPackage.ops` type is
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

const baselineMetadataWithoutHash: Omit<ExtensionMigrationPackage['metadata'], 'migrationHash'> = {
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
 */
export const cipherstashBaselineMigration: ExtensionMigrationPackage = {
  dirName: CIPHERSTASH_BASELINE_MIGRATION_NAME,
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
