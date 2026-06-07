import type { Contract } from '@prisma-next/contract/types';
import type {
  ControlAdapterInstance,
  ControlFamilyInstance,
  MigrationOperationPolicy,
  MigrationPlanner,
  MigrationPlannerResult,
  MigrationPlanWithAuthoringSurface,
  TargetMigrationsCapability,
} from '@prisma-next/framework-components/control';
import { createSqlContract } from '@prisma-next/test-utils';
import { describe, expect, it } from 'vitest';
import { createContractSpaceAggregate } from '../../src/aggregate/aggregate';
import { planMigration } from '../../src/aggregate/planner';
import type { ContractSpaceAggregate, ContractSpaceMember } from '../../src/aggregate/types';
import { EMPTY_CONTRACT_HASH } from '../../src/constants';
import type { OnDiskMigrationPackage } from '../../src/package';
import { createAttestedPackage, makeContractSpaceMember } from '../fixtures';

const POLICY: MigrationOperationPolicy = {
  allowedOperationClasses: ['additive', 'widening'],
};

function makeMember(args: {
  spaceId: string;
  contract?: Contract;
  headRef?: { hash: string; invariants: readonly string[] };
  packages?: readonly OnDiskMigrationPackage[];
}): ContractSpaceMember {
  return makeContractSpaceMember({
    spaceId: args.spaceId,
    contract: args.contract ?? createSqlContract({ target: 'postgres' }),
    headRef: args.headRef ?? { hash: EMPTY_CONTRACT_HASH, invariants: [] },
    packages: args.packages ?? [],
  });
}

function makeAggregate(args: {
  app: ContractSpaceMember;
  extensions?: ContractSpaceMember[];
  targetId?: string;
}): ContractSpaceAggregate {
  return createContractSpaceAggregate({
    targetId: args.targetId ?? 'postgres',
    app: args.app,
    extensions: args.extensions ?? [],
    checkIntegrity: () => [],
  });
}

/**
 * Stub planner for synth-strategy paths. Configured per test to either
 * return a synthetic success plan or a failure with conflicts.
 */
function makeStubPlanner(outcome: MigrationPlannerResult): MigrationPlanner<'sql', 'postgres'> {
  return {
    plan: () => outcome,
    emptyMigration: () => {
      throw new Error('not used');
    },
  };
}

function makeStubMigrations(
  planner: MigrationPlanner<'sql', 'postgres'>,
): TargetMigrationsCapability<'sql', 'postgres', ControlFamilyInstance<'sql', unknown>> {
  return {
    createPlanner: () => planner,
    createRunner: () => {
      throw new Error('runner not used by planner');
    },
    contractToSchema: () => ({ tables: {} }),
  };
}

const STUB_ADAPTER: ControlAdapterInstance<'sql', 'postgres'> =
  // The planner only forwards `adapter` to `migrations.createPlanner`
  // and never inspects fields on it. The cast is the minimum surface that
  // satisfies the generic.
  {} as unknown as ControlAdapterInstance<'sql', 'postgres'>;

function makeSyntheticPlan(targetId: string): MigrationPlanWithAuthoringSurface {
  return {
    targetId,
    origin: null,
    destination: { storageHash: 'sha256:synth-destination' },
    operations: [{ id: 'synth.op', label: 'Synthesised op', operationClass: 'additive' }],
    renderTypeScript: () => 'export {};',
  };
}

describe('planMigration', () => {
  it('selects synth for the app member when callerPolicy.ignoreGraphFor includes its spaceId', async () => {
    const aggregate = makeAggregate({
      app: makeMember({ spaceId: 'app' }),
    });
    const stubPlan = makeSyntheticPlan('placeholder-target-id-from-stub');
    const planner = makeStubPlanner({ kind: 'success', plan: stubPlan });

    const result = await planMigration({
      aggregate,
      currentDBState: {
        markersBySpaceId: new Map(),
        schemaIntrospection: { tables: {} },
      },
      adapter: STUB_ADAPTER,
      migrations: makeStubMigrations(planner),
      frameworkComponents: [],
      callerPolicy: { ignoreGraphFor: new Set(['app']) },
      operationPolicy: POLICY,
    });

    expect(result.ok).toBe(true);
    const success = result.assertOk();
    expect(success.applyOrder).toEqual(['app']);
    expect(success.perSpace.get('app')?.strategy).toBe('synth');
    // Aggregate planner overrides the family planner's targetId.
    expect(success.perSpace.get('app')?.plan.targetId).toBe('postgres');
  });

  it('selects graph-walk for an extension member with a non-empty graph reaching its head ref', async () => {
    const headHash = 'sha256:cipher-head';
    const cipherPkg = createAttestedPackage('20260101T0000_init', { from: null, to: headHash });
    const extension = makeMember({
      spaceId: 'cipherstash',
      headRef: { hash: headHash, invariants: [] },
      packages: [cipherPkg],
    });
    const aggregate = makeAggregate({
      app: makeMember({ spaceId: 'app' }),
      extensions: [extension],
    });

    const stubPlan = makeSyntheticPlan('postgres');
    const planner = makeStubPlanner({ kind: 'success', plan: stubPlan });

    const result = await planMigration({
      aggregate,
      currentDBState: {
        markersBySpaceId: new Map(),
        schemaIntrospection: { tables: {} },
      },
      adapter: STUB_ADAPTER,
      migrations: makeStubMigrations(planner),
      frameworkComponents: [],
      callerPolicy: { ignoreGraphFor: new Set(['app']) },
      operationPolicy: POLICY,
    });

    expect(result.ok).toBe(true);
    const success = result.assertOk();
    // Extension first, then app — matches concatenateSpaceApplyInputs
    // ordering and preserves MigrationRunnerFailure.failingSpace.
    expect(success.applyOrder).toEqual(['cipherstash', 'app']);
    expect(success.perSpace.get('cipherstash')?.strategy).toBe('graph-walk');
    expect(success.perSpace.get('cipherstash')?.plan.destination.storageHash).toBe(headHash);
    expect(success.perSpace.get('cipherstash')?.plan.targetId).toBe('postgres');
    // App strategy is synth per the caller policy.
    expect(success.perSpace.get('app')?.strategy).toBe('synth');
  });

  it('falls back to synth when an extension graph is empty and no invariants are required', async () => {
    const extension = makeMember({
      spaceId: 'cipherstash',
      headRef: { hash: EMPTY_CONTRACT_HASH, invariants: [] },
    });
    const aggregate = makeAggregate({
      app: makeMember({ spaceId: 'app' }),
      extensions: [extension],
    });

    const stubPlan = makeSyntheticPlan('postgres');
    const planner = makeStubPlanner({ kind: 'success', plan: stubPlan });

    const result = await planMigration({
      aggregate,
      currentDBState: {
        markersBySpaceId: new Map(),
        schemaIntrospection: { tables: {} },
      },
      adapter: STUB_ADAPTER,
      migrations: makeStubMigrations(planner),
      frameworkComponents: [],
      callerPolicy: { ignoreGraphFor: new Set(['app']) },
      operationPolicy: POLICY,
    });

    expect(result.ok).toBe(true);
    expect(result.assertOk().perSpace.get('cipherstash')?.strategy).toBe('synth');
  });

  it('rejects with policyConflict when ignoreGraphFor covers a member that declares non-empty invariants', async () => {
    const extension = makeMember({
      spaceId: 'cipherstash',
      headRef: { hash: EMPTY_CONTRACT_HASH, invariants: ['cipher:create-v1'] },
    });
    const aggregate = makeAggregate({
      app: makeMember({ spaceId: 'app' }),
      extensions: [extension],
    });

    const planner = makeStubPlanner({
      kind: 'success',
      plan: makeSyntheticPlan('postgres'),
    });

    const result = await planMigration({
      aggregate,
      currentDBState: {
        markersBySpaceId: new Map(),
        schemaIntrospection: { tables: {} },
      },
      adapter: STUB_ADAPTER,
      migrations: makeStubMigrations(planner),
      frameworkComponents: [],
      // ignoreGraphFor a space that requires graph-walk — that's a
      // policy conflict.
      callerPolicy: { ignoreGraphFor: new Set(['app', 'cipherstash']) },
      operationPolicy: POLICY,
    });

    expect(result.ok).toBe(false);
    const failure = result.assertNotOk();
    expect(failure.kind).toBe('policyConflict');
    if (failure.kind !== 'policyConflict') return;
    expect(failure.spaceId).toBe('cipherstash');
    expect(failure.detail).toContain('cipher:create-v1');
  });

  it('rejects with extensionPathUnsatisfiable when the empty-graph member declares non-empty invariants', async () => {
    const extension = makeMember({
      spaceId: 'cipherstash',
      headRef: { hash: EMPTY_CONTRACT_HASH, invariants: ['cipher:create-v1'] },
    });
    const aggregate = makeAggregate({
      app: makeMember({ spaceId: 'app' }),
      extensions: [extension],
    });

    const planner = makeStubPlanner({
      kind: 'success',
      plan: makeSyntheticPlan('postgres'),
    });

    const result = await planMigration({
      aggregate,
      currentDBState: {
        markersBySpaceId: new Map(),
        schemaIntrospection: { tables: {} },
      },
      adapter: STUB_ADAPTER,
      migrations: makeStubMigrations(planner),
      frameworkComponents: [],
      // Extension is not in ignoreGraphFor, but its graph is empty —
      // graph-walk can't satisfy its non-empty invariants.
      callerPolicy: { ignoreGraphFor: new Set(['app']) },
      operationPolicy: POLICY,
    });

    expect(result.ok).toBe(false);
    const failure = result.assertNotOk();
    expect(failure.kind).toBe('extensionPathUnsatisfiable');
    if (failure.kind !== 'extensionPathUnsatisfiable') return;
    expect(failure.spaceId).toBe('cipherstash');
    expect(failure.missingInvariants).toEqual(['cipher:create-v1']);
  });

  it('forwards synth-strategy planner failures as appSynthFailure', async () => {
    const aggregate = makeAggregate({
      app: makeMember({ spaceId: 'app' }),
    });
    const failingPlanner = makeStubPlanner({
      kind: 'failure',
      conflicts: [{ kind: 'typeMismatch', summary: 'incompatible column type' }],
    });

    const result = await planMigration({
      aggregate,
      currentDBState: {
        markersBySpaceId: new Map(),
        schemaIntrospection: { tables: {} },
      },
      adapter: STUB_ADAPTER,
      migrations: makeStubMigrations(failingPlanner),
      frameworkComponents: [],
      callerPolicy: { ignoreGraphFor: new Set(['app']) },
      operationPolicy: POLICY,
    });

    expect(result.ok).toBe(false);
    const failure = result.assertNotOk();
    expect(failure.kind).toBe('appSynthFailure');
    if (failure.kind !== 'appSynthFailure') return;
    expect(failure.spaceId).toBe('app');
    expect(failure.conflicts).toHaveLength(1);
  });
});
