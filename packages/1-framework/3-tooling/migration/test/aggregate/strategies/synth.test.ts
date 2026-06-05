import type {
  ControlFamilyInstance,
  MigrationOperationPolicy,
  MigrationPlanner,
  MigrationPlanWithAuthoringSurface,
  TargetMigrationsCapability,
} from '@prisma-next/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import { createSqlContract } from '@prisma-next/test-utils';
import { describe, expect, it } from 'vitest';
import { synthStrategy } from '../../../src/aggregate/strategies/synth';
import type { ContractSpaceMember } from '../../../src/aggregate/types';
import { makeContractSpaceMember } from '../../fixtures';

const POLICY: MigrationOperationPolicy = {
  allowedOperationClasses: ['additive', 'widening'],
};

const STUB_FAMILY: ControlFamilyInstance<'sql', unknown> = {} as unknown as ControlFamilyInstance<
  'sql',
  unknown
>;

function makeMember(spaceId: string, tables: Record<string, unknown>): ContractSpaceMember {
  return makeContractSpaceMember({
    spaceId,
    contract: createSqlContract({
      target: 'postgres',
      storage: {
        namespaces: {
          [UNBOUND_NAMESPACE_ID]: { id: UNBOUND_NAMESPACE_ID, entries: { table: tables } },
        },
      },
    }),
  });
}

function makeStubPlan(targetId: string): MigrationPlanWithAuthoringSurface {
  return {
    targetId,
    origin: null,
    destination: { storageHash: 'sha256:synth' },
    operations: [{ id: 'synth.op', label: 'Synthesised op', operationClass: 'additive' }],
    renderTypeScript: () => 'export {};',
  };
}

describe('synthStrategy', () => {
  it('projects the live schema before passing it to the family planner', async () => {
    let observedSchema: unknown;
    const stubPlanner: MigrationPlanner<'sql', 'postgres'> = {
      plan: ({ schema }) => {
        observedSchema = schema;
        return { kind: 'success', plan: makeStubPlan('placeholder') };
      },
      emptyMigration: () => {
        throw new Error('not used');
      },
    };
    const stubMigrations: TargetMigrationsCapability<
      'sql',
      'postgres',
      ControlFamilyInstance<'sql', unknown>
    > = {
      createPlanner: () => stubPlanner,
      createRunner: () => {
        throw new Error('runner not used');
      },
      contractToSchema: () => ({ tables: {} }),
    };

    const appMember = makeMember('app', { app_user: {} });
    const extMember = makeMember('cipher', { cipher_state: {} });

    const liveSchema = {
      tables: {
        app_user: { columns: { id: {} } },
        cipher_state: { columns: { id: {} } },
        orphan_table: { columns: {} },
      },
    };

    const outcome = await synthStrategy({
      aggregateTargetId: 'postgres',
      currentMarker: null,
      member: appMember,
      otherMembers: [extMember],
      schemaIntrospection: liveSchema,
      familyInstance: STUB_FAMILY,
      migrations: stubMigrations,
      frameworkComponents: [],
      operationPolicy: POLICY,
    });

    expect(outcome.kind).toBe('ok');
    if (outcome.kind !== 'ok') return;
    // Synth strategy stamps the aggregate's targetId, not the planner's.
    expect(outcome.result.plan.targetId).toBe('postgres');
    expect(outcome.result.strategy).toBe('synth');
    expect(outcome.result.migrationEdges).toEqual([
      {
        dirName: '',
        migrationHash: 'sha256:synth',
        from: '',
        to: 'sha256:synth',
        operationCount: 1,
      },
    ]);

    // Critical: the planner saw a schema with cipher_state pruned out.
    const observed = observedSchema as { tables: Record<string, unknown> };
    expect(Object.keys(observed.tables).sort()).toEqual(['app_user', 'orphan_table']);
  });

  it('forwards planner failures verbatim', async () => {
    const stubPlanner: MigrationPlanner<'sql', 'postgres'> = {
      plan: () => ({
        kind: 'failure',
        conflicts: [{ kind: 'typeMismatch', summary: 'incompatible' }],
      }),
      emptyMigration: () => {
        throw new Error('not used');
      },
    };
    const stubMigrations: TargetMigrationsCapability<
      'sql',
      'postgres',
      ControlFamilyInstance<'sql', unknown>
    > = {
      createPlanner: () => stubPlanner,
      createRunner: () => {
        throw new Error('runner not used');
      },
      contractToSchema: () => ({ tables: {} }),
    };

    const outcome = await synthStrategy({
      aggregateTargetId: 'postgres',
      currentMarker: null,
      member: makeMember('app', {}),
      otherMembers: [],
      schemaIntrospection: { tables: {} },
      familyInstance: STUB_FAMILY,
      migrations: stubMigrations,
      frameworkComponents: [],
      operationPolicy: POLICY,
    });

    expect(outcome.kind).toBe('failure');
    if (outcome.kind !== 'failure') return;
    expect(outcome.conflicts).toEqual([{ kind: 'typeMismatch', summary: 'incompatible' }]);
  });
});
