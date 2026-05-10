/**
 * pgvector contract space — baseline migration package.
 *
 * An extension's `contractSpace.migrations` is a list of in-memory
 * `MigrationPackage` values whose `ops` carry framework-level
 * `MigrationPlanOperation`s. The SQL family runner reads the additional
 * runtime fields (`target`, `precheck`, `execute`, `postcheck`) at
 * apply time.
 *
 * Ships a single baseline migration whose only op is
 * {@link installVectorExtensionOp} — it carries the
 * `CREATE EXTENSION IF NOT EXISTS vector` DDL plus a postcondition that
 * confirms the extension landed. Mirrors the prior
 * `databaseDependencies.init[0]` shape (precheck / execute / postcheck)
 * but as a `MigrationPackage` op so the framework's per-space runner /
 * verifier can manage it the same way it manages an application's own
 * migrations.
 *
 * The op carries the stable `pgvector:install-vector-v1` invariantId —
 * once published it is immutable.
 */

import type { SqlMigrationPlanOperation } from '@prisma-next/family-sql/control';
import type {
  ContractSpaceHeadRef,
  MigrationPackage,
  MigrationPlanOperation,
} from '@prisma-next/framework-components/control';
import { computeMigrationHash } from '@prisma-next/migration-tools/hash';
import { PGVECTOR_STORAGE_HASH, pgvectorContract } from './contract';
import { PGVECTOR_BASELINE_MIGRATION_NAME, PGVECTOR_INVARIANTS } from './contract-space-constants';

/**
 * Postgres-style `target.details` shape the SQL runner consumes when
 * executing extension-space ops. pgvector targets only Postgres;
 * locking the target id here keeps the per-op `target` literal narrow
 * without coupling to the Postgres adapter package's
 * `PostgresPlanTargetDetails`.
 */
type PostgresTargetDetails = {
  readonly schema: string;
  readonly objectType: 'extension';
  readonly name: string;
};

const installVectorExtensionOp: SqlMigrationPlanOperation<unknown> = {
  id: 'pgvector.install-vector-extension',
  label: 'Enable extension "vector"',
  operationClass: 'additive',
  invariantId: PGVECTOR_INVARIANTS.installVector,
  target: {
    id: 'postgres',
    details: {
      schema: 'public',
      objectType: 'extension',
      name: 'vector',
    } satisfies PostgresTargetDetails,
  },
  precheck: [
    {
      description: 'verify extension "vector" is not already enabled',
      sql: "SELECT NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector')",
    },
  ],
  execute: [
    {
      description: 'create extension "vector"',
      sql: 'CREATE EXTENSION IF NOT EXISTS vector',
    },
  ],
  postcheck: [
    {
      description: 'confirm extension "vector" is enabled',
      sql: "SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector')",
    },
  ],
};

const pgvectorBaselineOps: readonly MigrationPlanOperation[] = [installVectorExtensionOp];

/** Sorted list of invariantIds the baseline migration provides. */
export const PGVECTOR_BASELINE_INVARIANTS: readonly string[] = (() => {
  const ids = pgvectorBaselineOps
    .map((op) => op.invariantId)
    .filter((id): id is string => typeof id === 'string');
  return [...new Set(ids)].sort();
})();

const baselineMetadataWithoutHash: Omit<MigrationPackage['metadata'], 'migrationHash'> = {
  from: null,
  to: PGVECTOR_STORAGE_HASH,
  fromContract: null,
  toContract: pgvectorContract,
  hints: { used: [], applied: [], plannerVersion: '2.0.0' },
  labels: [],
  providedInvariants: PGVECTOR_BASELINE_INVARIANTS,
  createdAt: '2026-06-01T00:00:00.000Z',
};

/**
 * Baseline migration package the descriptor publishes via
 * `contractSpace.migrations`. The framework's emitter writes this to
 * `migrations/pgvector/<dirName>/{manifest,ops,contract}.json` in the
 * user's repo at `migrate` time.
 */
export const pgvectorBaselineMigration: MigrationPackage = {
  dirName: PGVECTOR_BASELINE_MIGRATION_NAME,
  metadata: {
    ...baselineMetadataWithoutHash,
    migrationHash: computeMigrationHash(baselineMetadataWithoutHash, pgvectorBaselineOps),
  },
  ops: pgvectorBaselineOps,
};

/**
 * Pinned head ref the descriptor publishes. The framework writes this
 * verbatim to `migrations/pgvector/refs/head.json` (with `invariants`
 * sorted alphabetically per the canonicalisation rules); the runner's
 * `findPathWithDecision` step consults `head.json` to decide which
 * migrations need to apply.
 */
export const pgvectorHeadRef: ContractSpaceHeadRef = {
  hash: PGVECTOR_STORAGE_HASH,
  invariants: PGVECTOR_BASELINE_INVARIANTS,
};
