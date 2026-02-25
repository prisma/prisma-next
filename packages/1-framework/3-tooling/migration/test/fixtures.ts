import type { ContractIR } from '@prisma-next/contract/ir';
import type { AbstractOp } from '@prisma-next/core-control-plane/abstract-ops';
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
    edgeId: null,
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

export function createTestOps(): readonly AbstractOp[] {
  return [
    {
      op: 'createTable',
      id: 'table.users',
      label: 'Create table users',
      operationClass: 'additive',
      pre: [{ id: 'tableNotExists', params: { table: 'users' } }],
      post: [{ id: 'tableExists', params: { table: 'users' } }],
      args: {
        table: 'users',
        columns: [
          {
            name: 'id',
            nativeType: 'integer',
            codecId: 'int4',
            nullable: false,
          },
          {
            name: 'email',
            nativeType: 'text',
            codecId: 'text',
            nullable: false,
          },
        ],
        primaryKey: { columns: ['id'] },
      },
    },
  ];
}
