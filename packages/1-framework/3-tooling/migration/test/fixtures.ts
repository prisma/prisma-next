import type { ContractIR } from '@prisma-next/contract/ir';
import type { MigrationPlanOperation } from '@prisma-next/core-control-plane/types';
import type { MigrationManifest } from '../src/types';

export function createTestContract(overrides: Partial<ContractIR> = {}): ContractIR {
  return {
    schemaVersion: '1',
    targetFamily: 'sql',
    target: 'postgres',
    models: {},
    relations: {},
    storage: { tables: {} },
    extensionPacks: {},
    capabilities: {},
    meta: {},
    sources: {},
    ...overrides,
  };
}

export function createTestManifest(overrides: Partial<MigrationManifest> = {}): MigrationManifest {
  const toContract = overrides.toContract ?? createTestContract();
  return {
    from: 'sha256:empty',
    to: 'sha256:abc123',
    migrationId: null,
    kind: 'regular',
    fromContract: null,
    toContract,
    hints: {
      used: [],
      applied: ['additive_only'],
      plannerVersion: '0.0.1',
      planningStrategy: 'additive',
    },
    labels: [],
    createdAt: '2026-02-25T14:30:00.000Z',
    ...overrides,
  };
}

export function createTestOps(): readonly MigrationPlanOperation[] {
  return [
    {
      id: 'table.users',
      label: 'Create table users',
      operationClass: 'additive',
    },
  ];
}
