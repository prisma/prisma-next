import type { SqlMigrationPlanOperation } from '@prisma-next/family-sql/control';
import type {
  ContractSpaceHeadRef,
  MigrationPackage,
  MigrationPlanOperation,
} from '@prisma-next/framework-components/control';
import { computeMigrationHash } from '@prisma-next/migration-tools/hash';
import {
  AUDIT_BASELINE_INVARIANT_ID,
  AUDIT_BASELINE_MIGRATION_NAME,
  AUDIT_EVENT_TABLE,
} from './constants';
import { AUDIT_STORAGE_HASH, auditContract } from './contract';

type PostgresTargetDetails = {
  readonly schema: string;
  readonly objectType: 'table';
  readonly name: string;
};

const createAuditEventOp: SqlMigrationPlanOperation<unknown> = {
  id: `audit.create-${AUDIT_EVENT_TABLE}`,
  label: `Create table "${AUDIT_EVENT_TABLE}"`,
  operationClass: 'additive',
  invariantId: AUDIT_BASELINE_INVARIANT_ID,
  target: {
    id: 'postgres',
    details: {
      schema: 'public',
      objectType: 'table',
      name: AUDIT_EVENT_TABLE,
    } satisfies PostgresTargetDetails,
  },
  precheck: [],
  execute: [
    {
      description: `Create table "${AUDIT_EVENT_TABLE}"`,
      sql: `CREATE TABLE IF NOT EXISTS public."${AUDIT_EVENT_TABLE}" (
        "id" text NOT NULL PRIMARY KEY,
        "actor" text NOT NULL,
        "action" text NOT NULL
      )`,
    },
  ],
  postcheck: [],
};

const auditBaselineOps: readonly MigrationPlanOperation[] = [createAuditEventOp];

export const AUDIT_BASELINE_INVARIANTS: readonly string[] = (() => {
  const ids = auditBaselineOps
    .map((op) => op.invariantId)
    .filter((id): id is string => typeof id === 'string');
  return [...new Set(ids)].sort();
})();

const baselineMetadataWithoutHash: Omit<MigrationPackage['metadata'], 'migrationHash'> = {
  from: null,
  to: AUDIT_STORAGE_HASH,
  fromContract: null,
  toContract: auditContract,
  hints: { used: [], applied: [], plannerVersion: '2.0.0' },
  labels: [],
  providedInvariants: AUDIT_BASELINE_INVARIANTS,
  createdAt: '2026-06-01T00:00:00.000Z',
};

export const auditBaselineMigration: MigrationPackage = {
  dirName: AUDIT_BASELINE_MIGRATION_NAME,
  metadata: {
    ...baselineMetadataWithoutHash,
    migrationHash: computeMigrationHash(baselineMetadataWithoutHash, auditBaselineOps),
  },
  ops: auditBaselineOps,
};

export const auditHeadRef: ContractSpaceHeadRef = {
  hash: AUDIT_STORAGE_HASH,
  invariants: AUDIT_BASELINE_INVARIANTS,
};
