import type { Contract } from '@prisma-next/contract/types';
import type {
  ContractSpaceAggregate,
  ContractSpaceMember,
  HydratedMigrationGraph,
} from '@prisma-next/migration-tools/aggregate';
import { EMPTY_CONTRACT_HASH } from '@prisma-next/migration-tools/constants';
import type { MigrationGraph } from '@prisma-next/migration-tools/graph';
import { ok, type Result } from '@prisma-next/utils/result';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  buildContractSpaceAggregate: vi.fn(),
  graphWalkStrategy: vi.fn(),
}));

vi.mock('../../src/utils/contract-space-aggregate-loader', async () => {
  const actual = await vi.importActual<
    typeof import('../../src/utils/contract-space-aggregate-loader')
  >('../../src/utils/contract-space-aggregate-loader');
  return {
    ...actual,
    buildContractSpaceAggregate: mocks.buildContractSpaceAggregate,
  };
});

vi.mock('@prisma-next/migration-tools/aggregate', async () => {
  const actual = await vi.importActual<typeof import('@prisma-next/migration-tools/aggregate')>(
    '@prisma-next/migration-tools/aggregate',
  );
  // Default behaviour: delegate to the real strategy. Tests installing
  // `mockReturnValue` / `mockReturnValueOnce` override this.
  mocks.graphWalkStrategy.mockImplementation(actual.graphWalkStrategy);
  return {
    ...actual,
    graphWalkStrategy: (input: Parameters<typeof actual.graphWalkStrategy>[0]) =>
      mocks.graphWalkStrategy(input),
  };
});

const { loadAggregateStatusSpaces, computeTotalPendingAcrossSpaces } = await import(
  '../../src/commands/migration-status'
);

const APP_HASH = `sha256:${'a'.repeat(64)}`;

function makeEmptyGraph(): MigrationGraph {
  return {
    nodes: new Set<string>(),
    forwardChain: new Map(),
    reverseChain: new Map(),
    migrationByHash: new Map(),
  };
}

function makeHydratedGraph(empty: boolean): HydratedMigrationGraph {
  if (empty) {
    return {
      graph: makeEmptyGraph(),
      packagesByMigrationHash: new Map(),
    };
  }
  return {
    graph: {
      nodes: new Set<string>([APP_HASH]),
      forwardChain: new Map(),
      reverseChain: new Map(),
      migrationByHash: new Map(),
    },
    packagesByMigrationHash: new Map(),
  };
}

function makeMember(spaceId: string, hash: string, empty = false): ContractSpaceMember {
  return {
    spaceId,
    contract: { storage: { storageHash: hash, tables: {} } } as unknown as Contract,
    headRef: { hash, invariants: [] },
    migrations: makeHydratedGraph(empty),
  };
}

function makeAggregate(args: {
  app: ContractSpaceMember;
  extensions?: readonly ContractSpaceMember[];
}): Result<ContractSpaceAggregate, never> {
  return ok({
    targetId: 'postgres',
    app: args.app,
    extensions: args.extensions ?? [],
  });
}

describe('loadAggregateStatusSpaces', () => {
  afterEach(async () => {
    mocks.buildContractSpaceAggregate.mockReset();
    // Reset back to delegating to the real strategy so prior `mockReturnValue`
    // installations don't leak between tests.
    const actual = await vi.importActual<typeof import('@prisma-next/migration-tools/aggregate')>(
      '@prisma-next/migration-tools/aggregate',
    );
    mocks.graphWalkStrategy.mockReset();
    mocks.graphWalkStrategy.mockImplementation(actual.graphWalkStrategy);
  });

  afterAll(() => {
    vi.doUnmock('../../src/utils/contract-space-aggregate-loader');
    vi.resetModules();
  });

  it('renders per-space rows as marker-unknown when markersBySpace is null', async () => {
    const app = makeMember('app', APP_HASH);
    const ext = makeMember('ext-a', EMPTY_CONTRACT_HASH, true);
    mocks.buildContractSpaceAggregate.mockResolvedValue(makeAggregate({ app, extensions: [ext] }));

    const rows = await loadAggregateStatusSpaces({
      targetId: 'postgres',
      migrationsDir: '/tmp/__nope',
      appContractRaw: {},
      extensionPacks: [],
      validateContract: () => ({}) as Contract,
      markersBySpace: null,
    });

    expect(mocks.buildContractSpaceAggregate).toHaveBeenCalledTimes(1);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row).not.toHaveProperty('markerHash');
      expect(row).not.toHaveProperty('pendingCount');
      expect(row).not.toHaveProperty('status');
    }
    expect(rows.map((r) => r.spaceId)).toEqual(['ext-a', 'app']);
  });

  it('renders per-space rows with marker fields when markersBySpace is a Map', async () => {
    const app = makeMember('app', APP_HASH);
    const ext = makeMember('ext-a', EMPTY_CONTRACT_HASH, true);
    mocks.buildContractSpaceAggregate.mockResolvedValue(makeAggregate({ app, extensions: [ext] }));

    const rows = await loadAggregateStatusSpaces({
      targetId: 'postgres',
      migrationsDir: '/tmp/__nope',
      appContractRaw: {},
      extensionPacks: [],
      validateContract: () => ({}) as Contract,
      markersBySpace: new Map(),
    });

    expect(rows).toHaveLength(2);
    const [extRow, appRow] = rows;
    expect(extRow).toMatchObject({
      spaceId: 'ext-a',
      kind: 'extension',
      headHash: EMPTY_CONTRACT_HASH,
      markerHash: null,
      pendingCount: 0,
      status: 'up-to-date',
    });
    expect(appRow).toMatchObject({
      spaceId: 'app',
      kind: 'app',
      headHash: APP_HASH,
      markerHash: null,
      pendingCount: 0,
    });
  });

  it('counts pending migrations (edges), not lowered ops — multi-op migration counts as one', async () => {
    const app = makeMember('app', APP_HASH, /*empty*/ false);
    mocks.buildContractSpaceAggregate.mockResolvedValue(makeAggregate({ app }));
    // One graph edge that lowers to three ops: pendingCount must be 1,
    // not 3 — a single authored migration is one unit of pending work.
    mocks.graphWalkStrategy.mockReturnValue({
      kind: 'ok',
      result: {
        plan: { operations: [{}, {}, {}] },
        migrationEdges: [
          {
            migrationHash: 'sha256:edge-1',
            dirName: 'd1',
            from: APP_HASH,
            to: APP_HASH,
            operationCount: 3,
          },
        ],
      },
    });

    const rows = await loadAggregateStatusSpaces({
      targetId: 'postgres',
      migrationsDir: '/tmp/__nope',
      appContractRaw: {},
      extensionPacks: [],
      validateContract: () => ({}) as Contract,
      markersBySpace: new Map(),
    });

    expect(rows[0]).toMatchObject({ spaceId: 'app', pendingCount: 1, status: 'pending' });
  });

  it('counts a zero-op migration as one pending unit', async () => {
    const app = makeMember('app', APP_HASH, /*empty*/ false);
    mocks.buildContractSpaceAggregate.mockResolvedValue(makeAggregate({ app }));
    mocks.graphWalkStrategy.mockReturnValue({
      kind: 'ok',
      result: {
        plan: { operations: [] },
        migrationEdges: [
          {
            migrationHash: 'sha256:edge-1',
            dirName: 'd1',
            from: APP_HASH,
            to: APP_HASH,
            operationCount: 0,
          },
        ],
      },
    });

    const rows = await loadAggregateStatusSpaces({
      targetId: 'postgres',
      migrationsDir: '/tmp/__nope',
      appContractRaw: {},
      extensionPacks: [],
      validateContract: () => ({}) as Contract,
      markersBySpace: new Map(),
    });

    expect(rows[0]).toMatchObject({ spaceId: 'app', pendingCount: 1, status: 'pending' });
  });
});

describe('computeTotalPendingAcrossSpaces', () => {
  it('returns undefined when no spaces are loaded', () => {
    expect(computeTotalPendingAcrossSpaces([])).toBeUndefined();
  });

  it('returns undefined when any per-space pendingCount is undefined (marker-unknown / offline)', () => {
    expect(
      computeTotalPendingAcrossSpaces([
        { spaceId: 'app', kind: 'app', headHash: APP_HASH, pendingCount: 2 },
        { spaceId: 'ext-a', kind: 'extension', headHash: 'sha256:ext-a' },
      ]),
    ).toBeUndefined();
  });

  it('sums per-space pendingCount when every space reports a defined count', () => {
    expect(
      computeTotalPendingAcrossSpaces([
        { spaceId: 'app', kind: 'app', headHash: APP_HASH, pendingCount: 2 },
        { spaceId: 'ext-a', kind: 'extension', headHash: 'sha256:ext-a', pendingCount: 3 },
      ]),
    ).toBe(5);
  });
});
