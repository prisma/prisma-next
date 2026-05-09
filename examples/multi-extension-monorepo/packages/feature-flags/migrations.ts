import type {
  ExtensionContractRef,
  SqlMigrationPlanOperation,
} from '@prisma-next/family-sql/control';
import type { MigrationPlanOperation } from '@prisma-next/framework-components/control';
import { computeMigrationHash } from '@prisma-next/migration-tools/hash';
import type { MigrationPackage } from '@prisma-next/migration-tools/package';
import {
  FEATURE_FLAG_TABLE,
  FEATURE_FLAGS_BASELINE_INVARIANT_ID,
  FEATURE_FLAGS_BASELINE_MIGRATION_NAME,
} from './constants';
import { FEATURE_FLAGS_STORAGE_HASH, featureFlagsContract } from './contract';

type PostgresTargetDetails = {
  readonly schema: string;
  readonly objectType: 'table';
  readonly name: string;
};

const createFeatureFlagOp: SqlMigrationPlanOperation<unknown> = {
  id: `feature-flags.create-${FEATURE_FLAG_TABLE}`,
  label: `Create table "${FEATURE_FLAG_TABLE}"`,
  operationClass: 'additive',
  invariantId: FEATURE_FLAGS_BASELINE_INVARIANT_ID,
  target: {
    id: 'postgres',
    details: {
      schema: 'public',
      objectType: 'table',
      name: FEATURE_FLAG_TABLE,
    } satisfies PostgresTargetDetails,
  },
  precheck: [],
  execute: [
    {
      description: `Create table "${FEATURE_FLAG_TABLE}"`,
      sql: `CREATE TABLE IF NOT EXISTS public."${FEATURE_FLAG_TABLE}" (
        "key" text NOT NULL PRIMARY KEY,
        "enabled" boolean NOT NULL
      )`,
    },
  ],
  postcheck: [],
};

const featureFlagsBaselineOps: readonly MigrationPlanOperation[] = [createFeatureFlagOp];

export const FEATURE_FLAGS_BASELINE_INVARIANTS: readonly string[] = (() => {
  const ids = featureFlagsBaselineOps
    .map((op) => op.invariantId)
    .filter((id): id is string => typeof id === 'string');
  return [...new Set(ids)].sort();
})();

const baselineMetadataWithoutHash: Omit<MigrationPackage['metadata'], 'migrationHash'> = {
  from: null,
  to: FEATURE_FLAGS_STORAGE_HASH,
  fromContract: null,
  toContract: featureFlagsContract,
  hints: { used: [], applied: [], plannerVersion: '2.0.0' },
  labels: [],
  providedInvariants: FEATURE_FLAGS_BASELINE_INVARIANTS,
  createdAt: '2026-06-01T00:00:00.000Z',
};

export const featureFlagsBaselineMigration: MigrationPackage = {
  dirName: FEATURE_FLAGS_BASELINE_MIGRATION_NAME,
  dirPath: FEATURE_FLAGS_BASELINE_MIGRATION_NAME,
  metadata: {
    ...baselineMetadataWithoutHash,
    migrationHash: computeMigrationHash(baselineMetadataWithoutHash, featureFlagsBaselineOps),
  },
  ops: featureFlagsBaselineOps,
};

export const featureFlagsHeadRef: ExtensionContractRef = {
  hash: FEATURE_FLAGS_STORAGE_HASH,
  invariants: FEATURE_FLAGS_BASELINE_INVARIANTS,
};
