import { CliStructuredError } from '@prisma-next/errors/control';
import { EMPTY_CONTRACT_HASH } from '@prisma-next/migration-tools/constants';
import { MigrationToolsError } from '@prisma-next/migration-tools/errors';
import { reconstructGraph } from '@prisma-next/migration-tools/migration-graph';
import type { OnDiskMigrationPackage } from '@prisma-next/migration-tools/package';
import type { ContractIR } from '@prisma-next/migration-tools/refs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  assertFromIsGraphNode,
  looksLikeFullHash,
  type ResolveFromForPlanInput,
  type ResolveToForPlanInput,
  resolveFromForPlan,
  resolveToForPlan,
} from '../../src/utils/plan-resolution';

const mocks = vi.hoisted(() => ({
  readRefs: vi.fn(),
  readRefSnapshot: vi.fn(),
}));

vi.mock('@prisma-next/migration-tools/refs', async () => {
  const actual = await vi.importActual<typeof import('@prisma-next/migration-tools/refs')>(
    '@prisma-next/migration-tools/refs',
  );
  return { ...actual, readRefs: mocks.readRefs, readRefSnapshot: mocks.readRefSnapshot };
});

const E = EMPTY_CONTRACT_HASH;
const HASH_A = `sha256:${'a'.repeat(64)}`;
const HASH_B = `sha256:${'b'.repeat(64)}`;
const HASH_ORPHAN = `sha256:${'d'.repeat(64)}`;

let migrationCounter = 0;

function makePkg(from: string, to: string, dirName: string): OnDiskMigrationPackage {
  migrationCounter += 1;
  return {
    dirName,
    dirPath: `/migrations/app/${dirName}`,
    metadata: {
      from: from === E ? null : from,
      to,
      migrationHash: `sha256:mig-${migrationCounter.toString().padStart(64, '0')}`,
      createdAt: `2026-03-01T09:00:00.${migrationCounter.toString().padStart(3, '0')}Z`,
      providedInvariants: [],
    },
    ops: [],
  };
}

function sampleContractIR(storageHash: string): ContractIR {
  return {
    contract: {
      schemaVersion: '1',
      targetFamily: 'sql',
      target: 'postgres',
      profileHash: `sha256:${'p'.repeat(64)}`,
      storage: { storageHash },
      models: {},
      roots: {},
    },
    contractDts: 'export type Contract = unknown;\n',
  };
}

function makeFamilyInstance(deserialize: (json: unknown) => unknown = (json) => json) {
  return {
    deserializeContract: vi.fn(deserialize),
  } as unknown as ResolveFromForPlanInput['familyInstance'];
}

function baseInput(
  overrides: Partial<ResolveFromForPlanInput> & Pick<ResolveFromForPlanInput, 'bundles' | 'graph'>,
): ResolveFromForPlanInput {
  return {
    refsDir: '/project/migrations/refs',
    familyInstance: makeFamilyInstance(),
    readBundleEndContract: vi.fn().mockResolvedValue({ storage: { storageHash: HASH_A } }),
    optionsFrom: undefined,
    ...overrides,
  };
}

function expectRefuse(error: CliStructuredError, migrationCode: string, fixFragment: string): void {
  expect(error.meta?.['code']).toBe(migrationCode);
  expect(error.fix).toContain(fixFragment);
}

describe('resolveFromForPlan', () => {
  beforeEach(() => {
    migrationCounter = 0;
    mocks.readRefs.mockReset();
    mocks.readRefSnapshot.mockReset();
    mocks.readRefs.mockResolvedValue({});
  });

  it('returns greenfield when db ref is absent and --from is omitted', async () => {
    const graph = reconstructGraph([]);
    const result = await resolveFromForPlan(baseInput({ bundles: [], graph }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ kind: 'greenfield', fromHash: null, fromContract: null });
    }
  });

  it('returns auto-baseline when graph is empty and db ref has a paired snapshot', async () => {
    mocks.readRefs.mockResolvedValue({ db: { hash: HASH_ORPHAN, invariants: [] } });
    mocks.readRefSnapshot.mockResolvedValue(sampleContractIR(HASH_ORPHAN));

    const graph = reconstructGraph([]);
    const familyInstance = makeFamilyInstance();
    const result = await resolveFromForPlan(baseInput({ bundles: [], graph, familyInstance }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.kind).toBe('auto-baseline');
      if (result.value.kind === 'auto-baseline') {
        expect(result.value.fromHash).toBe(HASH_ORPHAN);
        expect(result.value.contractDts).toContain('Contract');
      }
    }
    expect(mocks.readRefSnapshot).toHaveBeenCalledWith('/project/migrations/refs', 'db');
  });

  it('returns auto-baseline for explicit ref name on an empty graph', async () => {
    mocks.readRefs.mockResolvedValue({
      staging: { hash: HASH_ORPHAN, invariants: [] },
    });
    mocks.readRefSnapshot.mockResolvedValue(sampleContractIR(HASH_ORPHAN));

    const graph = reconstructGraph([]);
    const result = await resolveFromForPlan(
      baseInput({ bundles: [], graph, optionsFrom: 'staging' }),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.kind).toBe('auto-baseline');
    }
  });

  it('returns snapshot for db ref at graph tip with paired snapshot', async () => {
    const bundles = [makePkg(E, HASH_A, 'm1'), makePkg(HASH_A, HASH_B, 'm2')];
    const graph = reconstructGraph(bundles);
    mocks.readRefs.mockResolvedValue({ db: { hash: HASH_B, invariants: [] } });
    mocks.readRefSnapshot.mockResolvedValue(sampleContractIR(HASH_B));

    const result = await resolveFromForPlan(baseInput({ bundles, graph }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toMatchObject({ kind: 'snapshot', fromHash: HASH_B });
    }
  });

  it('returns snapshot for db ref at a non-tip graph node with paired snapshot', async () => {
    const bundles = [makePkg(E, HASH_A, 'm1'), makePkg(HASH_A, HASH_B, 'm2')];
    const graph = reconstructGraph(bundles);
    mocks.readRefs.mockResolvedValue({ db: { hash: HASH_A, invariants: [] } });
    mocks.readRefSnapshot.mockResolvedValue(sampleContractIR(HASH_A));

    const result = await resolveFromForPlan(baseInput({ bundles, graph }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toMatchObject({ kind: 'snapshot', fromHash: HASH_A });
    }
  });

  it('refuses forgot-the-flag when db ref hash is not a graph node', async () => {
    const bundles = [makePkg(E, HASH_A, 'm1'), makePkg(HASH_A, HASH_B, 'm2')];
    const graph = reconstructGraph(bundles);
    mocks.readRefs.mockResolvedValue({
      db: { hash: HASH_ORPHAN, invariants: [] },
      staging: { hash: HASH_B, invariants: [] },
    });
    mocks.readRefSnapshot.mockResolvedValue(sampleContractIR(HASH_ORPHAN));

    const result = await resolveFromForPlan(baseInput({ bundles, graph }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expectRefuse(result.failure, 'MIGRATION.HASH_NOT_IN_GRAPH', '--from staging');
      expect(result.failure.why).toContain(HASH_ORPHAN);
    }
  });

  it('refuses forgot-the-flag for explicit ref name whose hash is not a graph node', async () => {
    const bundles = [makePkg(E, HASH_A, 'm1')];
    const graph = reconstructGraph(bundles);
    mocks.readRefs.mockResolvedValue({ staging: { hash: HASH_ORPHAN, invariants: [] } });
    mocks.readRefSnapshot.mockResolvedValue(sampleContractIR(HASH_ORPHAN));

    const result = await resolveFromForPlan(baseInput({ bundles, graph, optionsFrom: 'staging' }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expectRefuse(result.failure, 'MIGRATION.HASH_NOT_IN_GRAPH', '--from');
    }
  });

  it('refuses forgot-the-flag for explicit full hash not in graph on non-empty graph', async () => {
    const bundles = [makePkg(E, HASH_A, 'm1')];
    const graph = reconstructGraph(bundles);
    mocks.readRefs.mockResolvedValue({ tip: { hash: HASH_A, invariants: [] } });

    const result = await resolveFromForPlan(
      baseInput({ bundles, graph, optionsFrom: HASH_ORPHAN }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expectRefuse(result.failure, 'MIGRATION.HASH_NOT_IN_GRAPH', '--from tip');
    }
    expect(looksLikeFullHash(HASH_ORPHAN)).toBe(true);
  });

  it('refuses snapshot-missing for explicit full hash not in graph on empty graph', async () => {
    mocks.readRefs.mockResolvedValue({});

    const graph = reconstructGraph([]);
    const result = await resolveFromForPlan(
      baseInput({ bundles: [], graph, optionsFrom: HASH_ORPHAN }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expectRefuse(result.failure, 'MIGRATION.SNAPSHOT_MISSING', HASH_ORPHAN);
    }
  });

  it('returns graph-node for explicit full hash that is a graph node', async () => {
    const bundles = [makePkg(E, HASH_A, 'm1')];
    const graph = reconstructGraph(bundles);
    mocks.readRefs.mockResolvedValue({});
    const readBundleEndContract = vi.fn().mockResolvedValue({ storage: { storageHash: HASH_A } });

    const result = await resolveFromForPlan(
      baseInput({ bundles, graph, optionsFrom: HASH_A, readBundleEndContract }),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toMatchObject({
        kind: 'graph-node',
        fromHash: HASH_A,
        sourceDir: '/migrations/app/m1',
      });
    }
    expect(readBundleEndContract).toHaveBeenCalledWith('/migrations/app/m1');
  });

  it('refuses snapshot-missing for legacy db ref without snapshot when hash is not a graph node', async () => {
    mocks.readRefs.mockResolvedValue({ db: { hash: HASH_ORPHAN, invariants: [] } });
    mocks.readRefSnapshot.mockResolvedValue(null);

    const graph = reconstructGraph([]);
    const result = await resolveFromForPlan(baseInput({ bundles: [], graph }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expectRefuse(result.failure, 'MIGRATION.SNAPSHOT_MISSING', 'db update --advance-ref db');
      expect(result.failure.fix).toContain('ref delete db');
    }
  });

  it('falls back to graph-node bundle source for legacy db ref without snapshot when hash is in graph', async () => {
    const bundles = [makePkg(E, HASH_A, 'm1')];
    const graph = reconstructGraph(bundles);
    mocks.readRefs.mockResolvedValue({ db: { hash: HASH_A, invariants: [] } });
    mocks.readRefSnapshot.mockResolvedValue(null);
    const readBundleEndContract = vi.fn().mockResolvedValue({ storage: { storageHash: HASH_A } });

    const result = await resolveFromForPlan(baseInput({ bundles, graph, readBundleEndContract }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.kind).toBe('graph-node');
    }
  });

  it('refuses snapshot-missing for explicit ref name without snapshot when hash is not a graph node', async () => {
    mocks.readRefs.mockResolvedValue({ staging: { hash: HASH_ORPHAN, invariants: [] } });
    mocks.readRefSnapshot.mockResolvedValue(null);

    const graph = reconstructGraph([]);
    const result = await resolveFromForPlan(
      baseInput({ bundles: [], graph, optionsFrom: 'staging' }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expectRefuse(result.failure, 'MIGRATION.SNAPSHOT_MISSING', 'advance-ref staging');
    }
  });

  it('surfaces contract validation failure for bad snapshot contract shape', async () => {
    mocks.readRefs.mockResolvedValue({ db: { hash: HASH_A, invariants: [] } });
    mocks.readRefSnapshot.mockResolvedValue({ contract: { bad: true }, contractDts: 'x' });
    const familyInstance = makeFamilyInstance(() => {
      throw new Error('unsupported legacy shape');
    });

    const graph = reconstructGraph([]);
    const result = await resolveFromForPlan(baseInput({ bundles: [], graph, familyInstance }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(String(result.failure.why)).toContain('deserialize');
    }
  });

  it('surfaces INVALID_REF_FILE when paired contract.d.ts is missing', async () => {
    mocks.readRefs.mockResolvedValue({ db: { hash: HASH_A, invariants: [] } });
    mocks.readRefSnapshot.mockRejectedValue(
      new MigrationToolsError('MIGRATION.INVALID_REF_FILE', 'Invalid ref file', {
        why: 'Missing paired contract.d.ts snapshot file',
        fix: 'Re-run db update.',
      }),
    );

    const graph = reconstructGraph([]);
    const result = await resolveFromForPlan(baseInput({ bundles: [], graph }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.meta?.['code']).toBe('MIGRATION.INVALID_REF_FILE');
    }
  });

  it('treats explicit --from db identically to implicit default', async () => {
    mocks.readRefs.mockResolvedValue({ db: { hash: HASH_ORPHAN, invariants: [] } });
    mocks.readRefSnapshot.mockResolvedValue(sampleContractIR(HASH_ORPHAN));

    const graph = reconstructGraph([]);
    const implicit = await resolveFromForPlan(baseInput({ bundles: [], graph }));
    const explicit = await resolveFromForPlan(baseInput({ bundles: [], graph, optionsFrom: 'db' }));

    expect(implicit.ok).toBe(true);
    expect(explicit.ok).toBe(true);
    if (implicit.ok && explicit.ok) {
      expect(implicit.value.kind).toBe(explicit.value.kind);
    }
  });
});

function baseToInput(
  overrides: Partial<ResolveToForPlanInput> & Pick<ResolveToForPlanInput, 'bundles' | 'graph'>,
): ResolveToForPlanInput {
  return {
    refsDir: '/project/migrations/refs',
    familyInstance: makeFamilyInstance(),
    readBundleEndContract: vi.fn().mockResolvedValue({ storage: { storageHash: HASH_A } }),
    readBundleEndArtifacts: vi.fn().mockResolvedValue({
      contractJson: { storage: { storageHash: HASH_A } },
      contractDts: 'export type Contract = unknown;\n',
    }),
    optionsFrom: undefined,
    ...overrides,
  };
}

describe('resolveToForPlan', () => {
  beforeEach(() => {
    migrationCounter = 0;
    mocks.readRefs.mockReset();
    mocks.readRefSnapshot.mockReset();
    mocks.readRefs.mockResolvedValue({});
  });

  it('resolves a ref name with a paired snapshot to its materialized contract', async () => {
    const bundles = [makePkg(E, HASH_A, 'm1'), makePkg(HASH_A, HASH_B, 'm2')];
    const graph = reconstructGraph(bundles);
    mocks.readRefs.mockResolvedValue({ staging: { hash: HASH_A, invariants: [] } });
    mocks.readRefSnapshot.mockResolvedValue(sampleContractIR(HASH_A));

    const result = await resolveToForPlan('staging', baseToInput({ bundles, graph }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.hash).toBe(HASH_A);
      expect(result.value.contractDts).toContain('Contract');
      expect(result.value.contractJson).toMatchObject({ storage: { storageHash: HASH_A } });
    }
  });

  it('resolves a full hash that is a graph node via the bundle end-contract artifacts', async () => {
    const bundles = [makePkg(E, HASH_A, 'm1')];
    const graph = reconstructGraph(bundles);
    mocks.readRefs.mockResolvedValue({});
    const readBundleEndArtifacts = vi.fn().mockResolvedValue({
      contractJson: { storage: { storageHash: HASH_A } },
      contractDts: 'export type Contract = unknown;\n',
    });

    const result = await resolveToForPlan(
      HASH_A,
      baseToInput({ bundles, graph, readBundleEndArtifacts }),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.hash).toBe(HASH_A);
      expect(result.value.contractJson).toMatchObject({ storage: { storageHash: HASH_A } });
    }
    expect(readBundleEndArtifacts).toHaveBeenCalledWith('/migrations/app/m1');
  });

  it('resolves <dir>^ to the predecessor (from) contract via the bundle artifacts', async () => {
    const bundles = [makePkg(E, HASH_A, 'm1'), makePkg(HASH_A, HASH_B, 'm2')];
    const graph = reconstructGraph(bundles);
    mocks.readRefs.mockResolvedValue({});
    const readBundleEndArtifacts = vi.fn().mockResolvedValue({
      contractJson: { storage: { storageHash: HASH_A } },
      contractDts: 'export type Contract = unknown;\n',
    });

    const result = await resolveToForPlan(
      'm2^',
      baseToInput({ bundles, graph, readBundleEndArtifacts }),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.hash).toBe(HASH_A);
    }
    expect(readBundleEndArtifacts).toHaveBeenCalledWith('/migrations/app/m1');
  });

  it('maps a not-found reference to a structured error', async () => {
    const bundles = [makePkg(E, HASH_A, 'm1')];
    const graph = reconstructGraph(bundles);
    mocks.readRefs.mockResolvedValue({});

    const result = await resolveToForPlan('does-not-exist', baseToInput({ bundles, graph }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.meta?.['input']).toBe('does-not-exist');
    }
  });
});

describe('assertFromIsGraphNode', () => {
  it('throws forgot-the-flag CliStructuredError for a non-graph-node hash', () => {
    const bundles = [makePkg(E, HASH_A, 'm1')];
    const graph = reconstructGraph(bundles);
    const refs = { tip: { hash: HASH_A, invariants: [] } };

    expect(() => assertFromIsGraphNode(HASH_ORPHAN, graph, refs, HASH_A)).toThrow(
      CliStructuredError,
    );

    try {
      assertFromIsGraphNode(HASH_ORPHAN, graph, refs, HASH_A);
    } catch (error) {
      if (CliStructuredError.is(error)) {
        expectRefuse(error, 'MIGRATION.HASH_NOT_IN_GRAPH', '--from tip');
      }
    }
  });
});
