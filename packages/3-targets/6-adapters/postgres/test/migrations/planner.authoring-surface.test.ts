import { type Contract, coreHash, profileHash } from '@prisma-next/contract/types';
import {
  contractToSchemaIR as contractToSchemaIRImpl,
  extractCodecControlHooks,
  type NativeTypeExpander,
} from '@prisma-next/family-sql/control';
import {
  APP_SPACE_ID,
  type MigrationPlanner,
  type MigrationPlannerSuccessResult,
} from '@prisma-next/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import { buildSqlNamespace, SqlStorage } from '@prisma-next/sql-contract/types';
import postgresTargetDescriptor, {
  postgresRenderDefault,
} from '@prisma-next/target-postgres/control';
import { applicationDomainOf } from '@prisma-next/test-utils';
import { describe, expect, it } from 'vitest';
import postgresAdapterDescriptor from '../../src/exports/control';

const adapterCodecHooks = extractCodecControlHooks([postgresAdapterDescriptor]);
const expandParameterizedNativeType: NativeTypeExpander = (input) => {
  if (!input.codecId) return input.nativeType;
  const hooks = adapterCodecHooks.get(input.codecId);
  return hooks?.expandNativeType?.(input) ?? input.nativeType;
};

function createEmptyContract(): Contract<SqlStorage> {
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('sha256:test'),
    storage: new SqlStorage({
      storageHash: coreHash('sha256:test'),
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: buildSqlNamespace({ id: UNBOUND_NAMESPACE_ID, entries: { table: {} } }),
      },
    }),
    roots: {},
    domain: applicationDomainOf({ models: {} }),
    capabilities: {},
    extensionPacks: {},
    meta: {},
  };
}

function makeFrameworkPlanner(): MigrationPlanner<'sql', 'postgres'> {
  return postgresTargetDescriptor.migrations.createPlanner({
    familyId: 'sql',
    extensions: [],
  } as never);
}

describe('PostgresMigrationPlanner authoring surface', () => {
  describe('plan(...).plan.renderTypeScript()', () => {
    it('emits a migration scaffold carrying the destination storage hash', () => {
      const planner = makeFrameworkPlanner();
      const contract = createEmptyContract();
      const fromSchemaIR = contractToSchemaIRImpl(null, {
        annotationNamespace: 'pg',
        expandNativeType: expandParameterizedNativeType,
        renderDefault: postgresRenderDefault,
      });

      const fromContract: Contract<SqlStorage> = {
        ...createEmptyContract(),
        storage: new SqlStorage({
          storageHash: coreHash('sha256:from'),
          namespaces: {
            [UNBOUND_NAMESPACE_ID]: buildSqlNamespace({ id: UNBOUND_NAMESPACE_ID, entries: { table: {} } }),
          },
        }),
      };
      const result = planner.plan({
        contract,
        schema: fromSchemaIR,
        policy: { allowedOperationClasses: ['additive'] },
        fromContract,
        frameworkComponents: [],
        spaceId: APP_SPACE_ID,
      });

      if (result.kind !== 'success') {
        throw new Error(`Expected planner success, got: ${JSON.stringify(result)}`);
      }
      const success = result as MigrationPlannerSuccessResult;

      const source = success.plan.renderTypeScript();

      expect(source).toContain("from '@prisma-next/postgres/migration'");
      expect(source).toMatch(/\bMigration\b/);
      expect(source).toContain('export default class M extends Migration');
      expect(source).toContain(`from: "${coreHash('sha256:from')}"`);
      expect(source).toContain(`to: "${contract.storage.storageHash}"`);
    });
  });

  describe('emptyMigration(context)', () => {
    it("identifies as the 'postgres' target with no operations and the supplied destination hash", () => {
      const planner = makeFrameworkPlanner();
      const empty = planner.emptyMigration(
        {
          packageDir: '/tmp/migration-pkg',
          fromHash: null,
          toHash: 'sha256:to',
        },
        APP_SPACE_ID,
      );

      expect(empty.targetId).toBe('postgres');
      expect(empty.operations).toEqual([]);
      expect(empty.destination).toEqual({ storageHash: 'sha256:to' });
    });

    it('renders a stub whose describe() carries from/to and whose operations list is empty', () => {
      const planner = makeFrameworkPlanner();
      const empty = planner.emptyMigration(
        {
          packageDir: '/tmp/migration-pkg',
          fromHash: 'sha256:from',
          toHash: 'sha256:to',
        },
        APP_SPACE_ID,
      );

      const source = empty.renderTypeScript();

      expect(source).toContain("from '@prisma-next/postgres/migration'");
      expect(source).toContain('export default class M extends Migration');
      expect(source).toContain('from: "sha256:from"');
      expect(source).toContain('to: "sha256:to"');
      expect(source).toContain('override get operations()');
    });
  });
});
