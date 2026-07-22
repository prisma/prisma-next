import type { Contract } from '@prisma-next/contract/types';
import { CliStructuredError } from '@prisma-next/errors/control';
import {
  type AggregateContractSpace,
  createAggregateContractSpace,
} from '@prisma-next/migration-tools/aggregate';
import { EMPTY_CONTRACT_HASH } from '@prisma-next/migration-tools/constants';
import { MigrationToolsError } from '@prisma-next/migration-tools/errors';
import { reconstructGraph } from '@prisma-next/migration-tools/migration-graph';
import type { OnDiskMigrationPackage } from '@prisma-next/migration-tools/package';
import type { ContractIR, Refs } from '@prisma-next/migration-tools/refs';
import { applicationDomainOf } from '@prisma-next/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  assertFromIsGraphNode,
  looksLikeFullHash,
  type ResolveFromForPlanInput,
  type ResolveToForPlanInput,
  resolveFromForPlan,
  resolveToForPlan,
} from '../../src/utils/plan-resolution';

const E = EMPTY_CONTRACT_HASH;
const HASH_A = `${'a'.repeat(64)}`;
const HASH_B = `${'b'.repeat(64)}`;
const HASH_ORPHAN = `${'d'.repeat(64)}`;

let migrationCounter = 0;

function makePkg(from: string, to: string, dirName: string): OnDiskMigrationPackage {
  migrationCounter += 1;
  return {
    dirName,
    dirPath: `/migrations/app/${dirName}`,
    metadata: {
      from: from === E ? null : from,
      to,
      migrationHash: `mig-${migrationCounter.toString().padStart(64, '0')}`,
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
      profileHash: `${'p'.repeat(64)}`,
      storage: { storageHash },
      domain: applicationDomainOf({ models: {} }),
      roots: {},
    },
    contractDts: 'export type Contract = unknown;\n',
  };
}

function contractAtResult(
  storageHash: string,
  opts?: { readonly provenance?: 'snapshot' | 'graph-node'; readonly sourceDir?: string },
): {
  hash: string;
  contract: Contract;
  contractJson: unknown;
  contractDts: string;
  provenance: 'snapshot' | 'graph-node';
  sourceDir?: string;
} {
  const ir = sampleContractIR(storageHash);
  const provenance = opts?.provenance ?? 'snapshot';
  return {
    hash: storageHash,
    contract: ir.contract as Contract,
    contractJson: ir.contract,
    contractDts: ir.contractDts,
    provenance,
    ...(provenance === 'graph-node' ? { sourceDir: opts?.sourceDir ?? '/migrations/app/m1' } : {}),
  };
}

function makeSpace(
  packages: readonly OnDiskMigrationPackage[],
  refs: Refs = {},
  contractAtImpl?: ReturnType<typeof vi.fn>,
) {
  const space = createAggregateContractSpace({
    spaceId: 'app',
    packages,
    refs,
    headRef:
      packages.length > 0
        ? { hash: packages[packages.length - 1]!.metadata.to, invariants: [] }
        : null,
    refsDir: '/project/migrations/refs',
    resolveContract: () => ({ storage: { storageHash: HASH_B } }) as Contract,
    deserializeContract: (json) => json as Contract,
  });
  if (contractAtImpl) {
    vi.spyOn(space, 'contractAt').mockImplementation(
      contractAtImpl as AggregateContractSpace['contractAt'],
    );
  }
  return space;
}

function baseInput(
  overrides: Partial<ResolveFromForPlanInput> & Pick<ResolveFromForPlanInput, 'space'>,
): ResolveFromForPlanInput {
  return {
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
  });

  it('returns greenfield when db ref is absent and --from is omitted', async () => {
    const space = makeSpace([]);
    const result = await resolveFromForPlan(baseInput({ space }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ kind: 'greenfield', fromHash: null, fromContract: null });
    }
  });

  it('returns auto-baseline when graph is empty and db ref has a paired snapshot', async () => {
    const space = makeSpace(
      [],
      { db: { hash: HASH_ORPHAN, invariants: [] } },
      vi.fn().mockResolvedValue(contractAtResult(HASH_ORPHAN)),
    );
    const result = await resolveFromForPlan(baseInput({ space }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.kind).toBe('auto-baseline');
      if (result.value.kind === 'auto-baseline') {
        expect(result.value.fromHash).toBe(HASH_ORPHAN);
        expect(result.value.contractDts).toContain('Contract');
      }
    }
    expect(space.contractAt).toHaveBeenCalledWith(HASH_ORPHAN, { refName: 'db' });
  });

  it('returns auto-baseline for explicit ref name on an empty graph', async () => {
    const space = makeSpace(
      [],
      { staging: { hash: HASH_ORPHAN, invariants: [] } },
      vi.fn().mockResolvedValue(contractAtResult(HASH_ORPHAN)),
    );
    const result = await resolveFromForPlan(baseInput({ space, optionsFrom: 'staging' }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.kind).toBe('auto-baseline');
    }
  });

  it('returns snapshot for db ref at graph tip with paired snapshot', async () => {
    const bundles = [makePkg(E, HASH_A, 'm1'), makePkg(HASH_A, HASH_B, 'm2')];
    const space = makeSpace(
      bundles,
      { db: { hash: HASH_B, invariants: [] } },
      vi.fn().mockResolvedValue(contractAtResult(HASH_B)),
    );
    const result = await resolveFromForPlan(baseInput({ space }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toMatchObject({ kind: 'snapshot', fromHash: HASH_B });
    }
  });

  it('returns snapshot for db ref at a non-tip graph node with paired snapshot', async () => {
    const bundles = [makePkg(E, HASH_A, 'm1'), makePkg(HASH_A, HASH_B, 'm2')];
    const space = makeSpace(
      bundles,
      { db: { hash: HASH_A, invariants: [] } },
      vi.fn().mockResolvedValue(contractAtResult(HASH_A)),
    );
    const result = await resolveFromForPlan(baseInput({ space }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toMatchObject({ kind: 'snapshot', fromHash: HASH_A });
    }
  });

  it('refuses forgot-the-flag when db ref hash is not a graph node', async () => {
    const bundles = [makePkg(E, HASH_A, 'm1'), makePkg(HASH_A, HASH_B, 'm2')];
    const space = makeSpace(
      bundles,
      {
        db: { hash: HASH_ORPHAN, invariants: [] },
        staging: { hash: HASH_B, invariants: [] },
      },
      vi.fn().mockResolvedValue(contractAtResult(HASH_ORPHAN)),
    );
    const result = await resolveFromForPlan(baseInput({ space }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expectRefuse(result.failure, 'MIGRATION.HASH_NOT_IN_GRAPH', '--from staging');
      expect(result.failure.why).toContain(HASH_ORPHAN);
    }
  });

  it('refuses forgot-the-flag for explicit ref name whose hash is not a graph node', async () => {
    const bundles = [makePkg(E, HASH_A, 'm1')];
    const space = makeSpace(
      bundles,
      { staging: { hash: HASH_ORPHAN, invariants: [] } },
      vi.fn().mockResolvedValue(contractAtResult(HASH_ORPHAN)),
    );
    const result = await resolveFromForPlan(baseInput({ space, optionsFrom: 'staging' }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expectRefuse(result.failure, 'MIGRATION.HASH_NOT_IN_GRAPH', '--from');
    }
  });

  it('refuses forgot-the-flag for explicit full hash not in graph on non-empty graph', async () => {
    const bundles = [makePkg(E, HASH_A, 'm1')];
    const space = makeSpace(bundles, { tip: { hash: HASH_A, invariants: [] } });
    const result = await resolveFromForPlan(baseInput({ space, optionsFrom: HASH_ORPHAN }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expectRefuse(result.failure, 'MIGRATION.HASH_NOT_IN_GRAPH', '--from tip');
    }
    expect(looksLikeFullHash(HASH_ORPHAN)).toBe(true);
  });

  it('refuses snapshot-missing for explicit full hash not in graph on empty graph', async () => {
    const space = makeSpace([]);
    const result = await resolveFromForPlan(baseInput({ space, optionsFrom: HASH_ORPHAN }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expectRefuse(result.failure, 'MIGRATION.SNAPSHOT_MISSING', HASH_ORPHAN);
    }
  });

  it('returns graph-node for explicit full hash that is a graph node', async () => {
    const bundles = [makePkg(E, HASH_A, 'm1')];
    const contractAt = vi
      .fn()
      .mockResolvedValue(
        contractAtResult(HASH_A, { provenance: 'graph-node', sourceDir: '/migrations/app/m1' }),
      );
    const space = makeSpace(bundles, {}, contractAt);
    const result = await resolveFromForPlan(baseInput({ space, optionsFrom: HASH_A }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toMatchObject({
        kind: 'graph-node',
        fromHash: HASH_A,
        sourceDir: '/migrations/app/m1',
      });
    }
    expect(contractAt).toHaveBeenCalledWith(HASH_A, undefined);
  });

  it('refuses snapshot-missing for legacy db ref without snapshot when hash is not a graph node', async () => {
    const space = makeSpace(
      [],
      { db: { hash: HASH_ORPHAN, invariants: [] } },
      vi.fn().mockRejectedValue(
        new MigrationToolsError(
          'MIGRATION.SNAPSHOT_MISSING',
          `Ref "db" has no paired contract snapshot`,
          {
            why: 'Ref "db" exists but its paired snapshot files are missing.',
            fix: 'Run "prisma-next db update --advance-ref db" to repopulate the snapshot, or "prisma-next ref delete db" to clear the orphan pointer.',
            details: { refName: 'db' },
          },
        ),
      ),
    );
    const result = await resolveFromForPlan(baseInput({ space }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expectRefuse(result.failure, 'MIGRATION.SNAPSHOT_MISSING', 'db update --advance-ref db');
      expect(result.failure.fix).toContain('ref delete db');
    }
  });

  it('falls back to graph-node bundle source for legacy db ref without snapshot when hash is in graph', async () => {
    const bundles = [makePkg(E, HASH_A, 'm1')];
    const space = makeSpace(
      bundles,
      { db: { hash: HASH_A, invariants: [] } },
      vi
        .fn()
        .mockResolvedValue(
          contractAtResult(HASH_A, { provenance: 'graph-node', sourceDir: '/migrations/app/m1' }),
        ),
    );
    const result = await resolveFromForPlan(baseInput({ space }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toMatchObject({
        kind: 'graph-node',
        fromHash: HASH_A,
        sourceDir: '/migrations/app/m1',
      });
    }
  });

  it('returns graph-node for explicit ref when snapshot is missing but hash is a graph node', async () => {
    const bundles = [makePkg(E, HASH_A, 'm1')];
    const space = makeSpace(
      bundles,
      { staging: { hash: HASH_A, invariants: [] } },
      vi
        .fn()
        .mockResolvedValue(
          contractAtResult(HASH_A, { provenance: 'graph-node', sourceDir: '/migrations/app/m1' }),
        ),
    );
    const result = await resolveFromForPlan(baseInput({ space, optionsFrom: 'staging' }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toMatchObject({
        kind: 'graph-node',
        fromHash: HASH_A,
        sourceDir: '/migrations/app/m1',
      });
    }
    expect(space.contractAt).toHaveBeenCalledWith(HASH_A, { refName: 'staging' });
  });

  it('refuses snapshot-missing for explicit ref name without snapshot when hash is not a graph node', async () => {
    const space = makeSpace(
      [],
      { staging: { hash: HASH_ORPHAN, invariants: [] } },
      vi.fn().mockRejectedValue(
        new MigrationToolsError(
          'MIGRATION.SNAPSHOT_MISSING',
          `Ref "staging" has no paired contract snapshot`,
          {
            why: 'Ref "staging" exists but its paired snapshot files are missing.',
            fix: 'Run "prisma-next db update --advance-ref staging" to repopulate the snapshot, or "prisma-next ref delete staging" to clear the orphan pointer.',
            details: { refName: 'staging' },
          },
        ),
      ),
    );
    const result = await resolveFromForPlan(baseInput({ space, optionsFrom: 'staging' }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expectRefuse(result.failure, 'MIGRATION.SNAPSHOT_MISSING', 'advance-ref staging');
    }
  });

  it('surfaces contract validation failure for bad snapshot contract shape', async () => {
    const space = makeSpace(
      [],
      { db: { hash: HASH_A, invariants: [] } },
      vi.fn().mockRejectedValue(
        new MigrationToolsError(
          'MIGRATION.CONTRACT_DESERIALIZATION_FAILED',
          'Contract failed to deserialize',
          {
            why: 'Contract at "/project/migrations/refs/db.contract.json" failed to deserialize: unsupported legacy shape',
            fix: 'Re-emit.',
            details: {
              filePath: '/project/migrations/refs/db.contract.json',
              message: 'unsupported legacy shape',
            },
          },
        ),
      ),
    );
    const result = await resolveFromForPlan(baseInput({ space }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(String(result.failure.why)).toContain('deserialize');
    }
  });

  it('surfaces INVALID_REF_FILE when paired contract.d.ts is missing', async () => {
    const space = makeSpace(
      [],
      { db: { hash: HASH_A, invariants: [] } },
      vi.fn().mockRejectedValue(
        new MigrationToolsError('MIGRATION.INVALID_REF_FILE', 'Invalid ref file', {
          why: 'Missing paired contract.d.ts snapshot file',
          fix: 'Re-run db update.',
        }),
      ),
    );
    const result = await resolveFromForPlan(baseInput({ space }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.meta?.['code']).toBe('MIGRATION.INVALID_REF_FILE');
    }
  });

  it('treats explicit --from db identically to implicit default', async () => {
    const space = makeSpace(
      [],
      { db: { hash: HASH_ORPHAN, invariants: [] } },
      vi.fn().mockResolvedValue(contractAtResult(HASH_ORPHAN)),
    );
    const implicit = await resolveFromForPlan(baseInput({ space }));
    const explicit = await resolveFromForPlan(baseInput({ space, optionsFrom: 'db' }));

    expect(implicit.ok).toBe(true);
    expect(explicit.ok).toBe(true);
    if (implicit.ok && explicit.ok) {
      expect(implicit.value.kind).toBe(explicit.value.kind);
    }
  });
});

function baseToInput(
  overrides: Partial<ResolveToForPlanInput> & Pick<ResolveToForPlanInput, 'space'>,
): ResolveToForPlanInput {
  return { ...overrides };
}

describe('resolveToForPlan', () => {
  beforeEach(() => {
    migrationCounter = 0;
  });

  it('resolves a ref name with a paired snapshot to its materialized contract', async () => {
    const bundles = [makePkg(E, HASH_A, 'm1'), makePkg(HASH_A, HASH_B, 'm2')];
    const space = makeSpace(
      bundles,
      { staging: { hash: HASH_A, invariants: [] } },
      vi.fn().mockResolvedValue(contractAtResult(HASH_A)),
    );
    const result = await resolveToForPlan('staging', baseToInput({ space }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.hash).toBe(HASH_A);
      expect(result.value.contractDts).toContain('Contract');
      expect(result.value.contractJson).toMatchObject({ storage: { storageHash: HASH_A } });
    }
  });

  it('resolves a full hash that is a graph node via the bundle end-contract artifacts', async () => {
    const bundles = [makePkg(E, HASH_A, 'm1')];
    const contractAt = vi
      .fn()
      .mockResolvedValue(
        contractAtResult(HASH_A, { provenance: 'graph-node', sourceDir: '/migrations/app/m1' }),
      );
    const space = makeSpace(bundles, {}, contractAt);
    const result = await resolveToForPlan(HASH_A, baseToInput({ space }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.hash).toBe(HASH_A);
      expect(result.value.contractJson).toMatchObject({ storage: { storageHash: HASH_A } });
    }
    expect(contractAt).toHaveBeenCalledWith(HASH_A, undefined);
  });

  it('resolves <dir>^ to the predecessor (from) contract via the bundle artifacts', async () => {
    const bundles = [makePkg(E, HASH_A, 'm1'), makePkg(HASH_A, HASH_B, 'm2')];
    const contractAt = vi
      .fn()
      .mockResolvedValue(
        contractAtResult(HASH_A, { provenance: 'graph-node', sourceDir: '/migrations/app/m1' }),
      );
    const space = makeSpace(bundles, {}, contractAt);
    const result = await resolveToForPlan('m2^', baseToInput({ space }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.hash).toBe(HASH_A);
    }
    expect(contractAt).toHaveBeenCalledWith(HASH_A, undefined);
  });

  it('maps a not-found reference to a structured error', async () => {
    const bundles = [makePkg(E, HASH_A, 'm1')];
    const space = makeSpace(bundles);
    const result = await resolveToForPlan('does-not-exist', baseToInput({ space }));

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
