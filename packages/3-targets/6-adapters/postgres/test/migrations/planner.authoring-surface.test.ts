import { type Contract, coreHash, profileHash } from '@prisma-next/contract/types';
import {
  APP_SPACE_ID,
  type MigrationPlanner,
  type MigrationPlannerSuccessResult,
} from '@prisma-next/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import { SqlStorage } from '@prisma-next/sql-contract/types';
import postgresTargetDescriptor from '@prisma-next/target-postgres/control';
import {
  PostgresDatabaseSchemaNode,
  PostgresNamespaceSchemaNode,
  postgresCreateNamespace,
} from '@prisma-next/target-postgres/types';
import { applicationDomainOf } from '@prisma-next/test-utils';
import { describe, expect, it } from 'vitest';

function createEmptyContract(): Contract<SqlStorage> {
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('test'),
    storage: new SqlStorage({
      storageHash: coreHash('test'),
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: postgresCreateNamespace({
          id: UNBOUND_NAMESPACE_ID,
          entries: { table: {} },
        }),
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
      const fromSchemaIR = new PostgresDatabaseSchemaNode({
        namespaces: {
          public: new PostgresNamespaceSchemaNode({
            schemaName: 'public',
            tables: {},
          }),
        },
        pgVersion: '',
        roles: [],
        existingSchemas: [],
      });

      const fromContract: Contract<SqlStorage> = {
        ...createEmptyContract(),
        storage: new SqlStorage({
          storageHash: coreHash('from-hash-stub'),
          namespaces: {
            [UNBOUND_NAMESPACE_ID]: postgresCreateNamespace({
              id: UNBOUND_NAMESPACE_ID,
              entries: { table: {} },
            }),
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
      // New shape: base derives describe() from the imported contract JSON, so
      // the scaffold carries `Migration<Start, End>` + the JSON/field imports
      // and emits no describe()/hash literals.
      expect(source).toContain('export default class M extends Migration<Start, End>');
      expect(source).toContain('override readonly endContractJson = endContract;');
      expect(source).not.toContain('describe()');
      expect(source).not.toContain(coreHash('from-hash-stub'));
    });
  });

  describe('emptyMigration(context)', () => {
    it("identifies as the 'postgres' target with no operations and the supplied destination hash", () => {
      const planner = makeFrameworkPlanner();
      const empty = planner.emptyMigration(
        {
          packageDir: '/tmp/migration-pkg',
          fromHash: null,
          toHash: 'to-hash-stub',
        },
        APP_SPACE_ID,
      );

      expect(empty.targetId).toBe('postgres');
      expect(empty.operations).toEqual([]);
      expect(empty.destination).toEqual({ storageHash: 'to-hash-stub' });
    });

    it('renders a stub that derives from/to from contract JSON and has an empty operations list', () => {
      const planner = makeFrameworkPlanner();
      const empty = planner.emptyMigration(
        {
          packageDir: '/tmp/migration-pkg',
          fromHash: 'from-hash-stub',
          toHash: 'to-hash-stub',
        },
        APP_SPACE_ID,
      );

      const source = empty.renderTypeScript();

      expect(source).toContain("from '@prisma-next/postgres/migration'");
      expect(source).toContain('export default class M extends Migration<Start, End>');
      expect(source).toContain('override readonly endContractJson = endContract;');
      expect(source).not.toContain('describe()');
      expect(source).not.toContain('"from-hash-stub"');
      expect(source).not.toContain('"to-hash-stub"');
      expect(source).toContain('override get operations()');
    });
  });
});
