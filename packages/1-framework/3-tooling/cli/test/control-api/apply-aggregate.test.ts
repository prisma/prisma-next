import type {
  ControlDriverInstance,
  ControlFamilyInstance,
  MigrationPlan,
  MultiSpaceRunnerResult,
  TargetMigrationsCapability,
} from '@prisma-next/framework-components/control';
import type {
  AggregatePerSpacePlan,
  ContractSpaceAggregate,
  ContractSpaceMember,
} from '@prisma-next/migration-tools/aggregate';
import { createContractSpaceAggregate } from '@prisma-next/migration-tools/aggregate';
import { ok } from '@prisma-next/utils/result';
import { describe, expect, it, vi } from 'vitest';
import {
  type AggregateApplyAction,
  applyAggregate,
} from '../../src/control-api/operations/apply-aggregate';
import type { ControlProgressEvent } from '../../src/control-api/types';

const APP_HASH = `sha256:${'a'.repeat(64)}`;

function makeAppMember(): ContractSpaceMember {
  const contract = {
    storage: { storageHash: APP_HASH, tables: {} },
  } as unknown as ReturnType<ContractSpaceMember['contract']>;
  return {
    spaceId: 'app',
    packages: [],
    refs: {},
    headRef: { hash: APP_HASH, invariants: [] },
    graph: () => ({
      nodes: new Set<string>([APP_HASH]),
      forwardChain: new Map(),
      reverseChain: new Map(),
      migrationByHash: new Map(),
    }),
    contract: () => contract,
  };
}

function makeAggregate(): ContractSpaceAggregate {
  return createContractSpaceAggregate({
    targetId: 'postgres',
    app: makeAppMember(),
    extensions: [],
    checkIntegrity: () => [],
  });
}

function makePerSpacePlan(): AggregatePerSpacePlan {
  const plan: MigrationPlan = {
    targetId: 'postgres',
    spaceId: 'app',
    origin: null,
    destination: { storageHash: APP_HASH },
    operations: [],
    providedInvariants: [],
  };
  return {
    plan,
    displayOps: [],
    destinationContract: makeAppMember().contract,
    strategy: 'graph-walk',
    migrationEdges: [],
    pathDecision: undefined,
  } as unknown as AggregatePerSpacePlan;
}

function makeMigrations(): TargetMigrationsCapability<
  'sql',
  'postgres',
  ControlFamilyInstance<'sql', unknown>
> {
  const runnerResult: MultiSpaceRunnerResult = ok({
    perSpaceResults: [{ space: 'app', value: { operationsPlanned: 0, operationsExecuted: 0 } }],
  }) as unknown as MultiSpaceRunnerResult;
  return {
    createRunner: () => ({
      execute: vi.fn(),
      executeAcrossSpaces: async () => runnerResult,
    }),
  } as unknown as TargetMigrationsCapability<
    'sql',
    'postgres',
    ControlFamilyInstance<'sql', unknown>
  >;
}

async function runWithAction(action: AggregateApplyAction): Promise<ControlProgressEvent[]> {
  const events: ControlProgressEvent[] = [];
  const aggregate = makeAggregate();
  const perSpacePlans = new Map([['app', makePerSpacePlan()]]);

  await applyAggregate<'sql', 'postgres'>({
    aggregate,
    perSpacePlans,
    applyOrder: ['app'],
    driver: {} as ControlDriverInstance<'sql', 'postgres'>,
    familyInstance: { familyId: 'sql' } as unknown as ControlFamilyInstance<'sql', unknown>,
    migrations: makeMigrations(),
    frameworkComponents: [],
    policy: { allowedOperationClasses: ['additive', 'widening', 'destructive', 'data'] },
    action,
    onProgress: (event) => events.push(event),
  });
  return events;
}

describe('applyAggregate apply span label', () => {
  it('emits the `dbInit` label for action=dbInit', async () => {
    const events = await runWithAction('dbInit');
    const start = events.find((e) => e.kind === 'spanStart' && e.spanId === 'apply');
    expect(start).toMatchObject({
      action: 'dbInit',
      label: 'Initialising database across spaces',
    });
  });

  it('emits the `dbUpdate` label for action=dbUpdate', async () => {
    const events = await runWithAction('dbUpdate');
    const start = events.find((e) => e.kind === 'spanStart' && e.spanId === 'apply');
    expect(start).toMatchObject({
      action: 'dbUpdate',
      label: 'Updating database across spaces',
    });
  });

  it('emits the `migrationApply` label for action=migrationApply', async () => {
    const events = await runWithAction('migrationApply');
    const start = events.find((e) => e.kind === 'spanStart' && e.spanId === 'apply');
    expect(start).toMatchObject({
      action: 'migrationApply',
      label: 'Applying migration plan across spaces',
    });
  });
});
