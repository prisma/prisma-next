import postgresAdapterDescriptor from '@prisma-next/adapter-postgres/control';
import { type Contract, coreHash, profileHash } from '@prisma-next/contract/types';
import {
  contractToSchemaIR as contractToSchemaIRImpl,
  extractCodecControlHooks,
  type NativeTypeExpander,
} from '@prisma-next/family-sql/control';
import type {
  MigrationPlanner,
  MigrationPlannerSuccessResult,
} from '@prisma-next/framework-components/control';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import { describe, expect, it } from 'vitest';
import postgresTargetDescriptor, { postgresRenderDefault } from '../../src/exports/control';

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
    storage: {
      storageHash: coreHash('sha256:test'),
      tables: {},
    },
    roots: {},
    models: {},
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
    it('emits a class-flow migration scaffold carrying the destination storage hash', () => {
      const planner = makeFrameworkPlanner();
      const contract = createEmptyContract();
      const fromSchemaIR = contractToSchemaIRImpl(null, {
        annotationNamespace: 'pg',
        expandNativeType: expandParameterizedNativeType,
        renderDefault: postgresRenderDefault,
      });

      const result = planner.plan({
        contract,
        schema: fromSchemaIR,
        policy: { allowedOperationClasses: ['additive'] },
        fromHash: coreHash('sha256:from'),
        frameworkComponents: [],
      });

      if (result.kind !== 'success') {
        throw new Error(`Expected planner success, got: ${JSON.stringify(result)}`);
      }
      const success = result as MigrationPlannerSuccessResult;

      const source = success.plan.renderTypeScript();

      expect(source).toContain("import { Migration } from '@prisma-next/family-sql/migration'");
      expect(source).toContain('class M extends Migration');
      expect(source).toContain(`from: "${coreHash('sha256:from')}"`);
      expect(source).toContain(`to: "${contract.storage.storageHash}"`);
    });
  });

  describe('emptyMigration(context)', () => {
    it("identifies as the 'postgres' target with no operations and the supplied destination hash", () => {
      const planner = makeFrameworkPlanner();
      const empty = planner.emptyMigration({
        packageDir: '/tmp/migration-pkg',
        fromHash: '',
        toHash: 'sha256:to',
      });

      expect(empty.targetId).toBe('postgres');
      expect(empty.operations).toEqual([]);
      expect(empty.destination).toEqual({ storageHash: 'sha256:to' });
    });

    it('renders a class-flow stub whose describe() carries from/to and whose operations list is empty', () => {
      const planner = makeFrameworkPlanner();
      const empty = planner.emptyMigration({
        packageDir: '/tmp/migration-pkg',
        fromHash: 'sha256:from',
        toHash: 'sha256:to',
      });

      const source = empty.renderTypeScript();

      expect(source).toContain("import { Migration } from '@prisma-next/family-sql/migration'");
      expect(source).toContain('class M extends Migration');
      expect(source).toContain('from: "sha256:from"');
      expect(source).toContain('to: "sha256:to"');
      expect(source).toContain('override get operations()');
    });
  });
});
