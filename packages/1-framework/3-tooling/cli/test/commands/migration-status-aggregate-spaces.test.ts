import type { Contract } from '@prisma-next/contract/types';
import type {
  ContractSpaceAggregate,
  ContractSpaceMember,
  GraphWalkOutcome,
} from '@prisma-next/migration-tools/aggregate';
import * as migrationAggregate from '@prisma-next/migration-tools/aggregate';
import { createContractSpaceAggregate } from '@prisma-next/migration-tools/aggregate';
import { EMPTY_CONTRACT_HASH } from '@prisma-next/migration-tools/constants';
import type { MigrationGraph } from '@prisma-next/migration-tools/graph';
import { createSqlContract } from '@prisma-next/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';

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

function makeNonEmptyGraph(): MigrationGraph {
  return {
    nodes: new Set<string>([APP_HASH]),
    forwardChain: new Map(),
    reverseChain: new Map(),
    migrationByHash: new Map(),
  };
}

function makeMember(spaceId: string, hash: string, empty = false): ContractSpaceMember {
  const base = createSqlContract();
  const contract: Contract = {
    ...base,
    storage: {
      ...base.storage,
      storageHash: hash as Contract['storage'] extends { storageHash: infer H } ? H : never,
    },
  };
  // Construct the new tolerant-member shape directly: the code path under
  // test reads `spaceId`, `headRef`, and `graph().nodes.size`; the graph is
  // stubbed so emptiness is controlled without materialising packages.
  return {
    spaceId,
    packages: [],
    refs: {},
    headRef: { hash, invariants: [] },
    graph: () => (empty ? makeEmptyGraph() : makeNonEmptyGraph()),
    contract: () => contract,
    contractAt: vi.fn(),
  };
}

function makeAggregate(args: {
  app: ContractSpaceMember;
  extensions?: readonly ContractSpaceMember[];
}): ContractSpaceAggregate {
  return createContractSpaceAggregate({
    targetId: 'postgres',
    app: args.app,
    extensions: args.extensions ?? [],
    checkIntegrity: () => [],
  });
}

describe('loadAggregateStatusSpaces', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders per-space rows as marker-unknown when markersBySpace is null', async () => {
    const app = makeMember('app', APP_HASH);
    const ext = makeMember('ext-a', EMPTY_CONTRACT_HASH, true);
    const rows = await loadAggregateStatusSpaces({
      aggregate: makeAggregate({ app, extensions: [ext] }),
      extensionPacks: [],
      markersBySpace: null,
    });
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
    const rows = await loadAggregateStatusSpaces({
      aggregate: makeAggregate({ app, extensions: [ext] }),
      extensionPacks: [],
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
    // One graph edge that lowers to three ops: pendingCount must be 1,
    // not 3 — a single authored migration is one unit of pending work.
    vi.spyOn(migrationAggregate, 'graphWalkStrategy').mockReturnValue({
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
    } as unknown as GraphWalkOutcome);

    const rows = await loadAggregateStatusSpaces({
      aggregate: makeAggregate({ app }),
      extensionPacks: [],
      markersBySpace: new Map(),
    });

    expect(rows[0]).toMatchObject({ spaceId: 'app', pendingCount: 1, status: 'pending' });
  });

  it('counts a zero-op migration as one pending unit', async () => {
    const app = makeMember('app', APP_HASH, /*empty*/ false);
    vi.spyOn(migrationAggregate, 'graphWalkStrategy').mockReturnValue({
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
    } as unknown as GraphWalkOutcome);

    const rows = await loadAggregateStatusSpaces({
      aggregate: makeAggregate({ app }),
      extensionPacks: [],
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
