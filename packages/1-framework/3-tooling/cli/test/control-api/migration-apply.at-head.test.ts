import type { Contract } from '@prisma-next/contract/types';
import type {
  ControlDriverInstance,
  ControlFamilyInstance,
  TargetMigrationsCapability,
} from '@prisma-next/framework-components/control';
import type {
  ContractSpaceAggregate,
  ContractSpaceMember,
  HydratedMigrationGraph,
} from '@prisma-next/migration-tools/aggregate';
import type { MigrationGraph } from '@prisma-next/migration-tools/graph';
import { ok } from '@prisma-next/utils/result';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  buildContractSpaceAggregate: vi.fn(),
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

// The cli package runs with `isolate: false` (see vitest.config.ts), so
// other test files in this worker may have already evaluated
// `migration-apply` with the real loader bound. Reset the module graph
// before importing so this file's `vi.mock` is the active binding.
let executeMigrationApply: typeof import('../../src/control-api/operations/migration-apply').executeMigrationApply;
beforeEach(async () => {
  vi.resetModules();
  ({ executeMigrationApply } = await import('../../src/control-api/operations/migration-apply'));
});

const APP_HASH = `sha256:${'a'.repeat(64)}`;

function makeEmptyGraph(): MigrationGraph {
  return {
    nodes: new Set<string>(),
    forwardChain: new Map(),
    reverseChain: new Map(),
    migrationByHash: new Map(),
  };
}

function makeEmptyHydrated(): HydratedMigrationGraph {
  return {
    graph: makeEmptyGraph(),
    packagesByMigrationHash: new Map(),
  };
}

function makeMember(spaceId: string, hash: string): ContractSpaceMember {
  return {
    spaceId,
    contract: { storage: { storageHash: hash, tables: {} } } as unknown as Contract,
    headRef: { hash, invariants: [] },
    migrations: makeEmptyHydrated(),
  };
}

function makeAggregate(args: {
  app: ContractSpaceMember;
  extensions: readonly ContractSpaceMember[];
}): ContractSpaceAggregate {
  return {
    targetId: 'postgres',
    app: args.app,
    extensions: args.extensions,
  };
}

describe('executeMigrationApply: empty-graph at-head members', () => {
  it('records a zero-op resolution for an extension whose empty graph already matches its marker', async () => {
    const EXT_HASH = `sha256:${'b'.repeat(64)}`;
    const app = makeMember('app', APP_HASH);
    const ext = makeMember('ext-a', EXT_HASH);
    mocks.buildContractSpaceAggregate.mockResolvedValue(
      ok(makeAggregate({ app, extensions: [ext] })),
    );

    const familyInstance = {
      familyId: 'sql',
      readAllMarkers: vi.fn().mockResolvedValue(
        new Map([
          ['app', { storageHash: APP_HASH, invariants: [] }],
          ['ext-a', { storageHash: EXT_HASH, invariants: [] }],
        ]),
      ),
      validateContract: (json: unknown) => json as Contract,
    } as unknown as ControlFamilyInstance<'sql', unknown>;

    const executeAcrossSpaces = vi.fn();
    const migrations = {
      createPlanner: () => ({ plan: vi.fn() }),
      createRunner: () => ({ executeAcrossSpaces }),
    } as unknown as TargetMigrationsCapability<
      'sql',
      'postgres',
      ControlFamilyInstance<'sql', unknown>
    >;

    const driver = { close: vi.fn() } as unknown as ControlDriverInstance<'sql', 'postgres'>;

    const result = await executeMigrationApply({
      driver,
      familyInstance,
      contract: { storage: { storageHash: APP_HASH, tables: {} } } as unknown as Contract,
      migrations,
      frameworkComponents: [],
      migrationsDir: '/tmp/__nope',
      extensionPacks: [],
      targetId: 'postgres',
      appMigrationPackages: [],
    });

    if (!result.ok) {
      throw new Error(`expected ok result, got: ${JSON.stringify(result.failure)}`);
    }

    expect(executeAcrossSpaces).not.toHaveBeenCalled();
    const spaces = result.value.perSpace.map((s) => s.spaceId).sort();
    expect(spaces).toEqual(['app', 'ext-a']);
    const extEntry = result.value.perSpace.find((s) => s.spaceId === 'ext-a');
    expect(extEntry).toBeDefined();
    expect(extEntry?.operations).toEqual([]);
    expect(extEntry?.marker?.storageHash).toBe(EXT_HASH);
  });
});
