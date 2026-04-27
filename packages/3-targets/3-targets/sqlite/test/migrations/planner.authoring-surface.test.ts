import { type Contract, coreHash, profileHash } from '@prisma-next/contract/types';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import { describe, expect, it } from 'vitest';
import { createSqliteMigrationPlanner } from '../../src/core/migrations/planner';

function createContract(): Contract<SqlStorage> {
  return {
    target: 'sqlite',
    targetFamily: 'sql',
    profileHash: profileHash('sha256:profile'),
    storage: {
      storageHash: coreHash('sha256:to'),
      tables: {
        user: {
          columns: {
            id: { nativeType: 'integer', codecId: 'sqlite/integer@1', nullable: false },
            email: { nativeType: 'text', codecId: 'sqlite/text@1', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          uniques: [],
          indexes: [],
          foreignKeys: [],
        },
      },
    },
    roots: {},
    models: {},
    capabilities: {},
    extensionPacks: {},
    meta: {},
  };
}

const emptySchema: SqlSchemaIR = { tables: {}, dependencies: [] };

describe('SqliteMigrationPlanner authoring surface', () => {
  describe('plan(...).plan', () => {
    it('returns a TypeScriptRenderableSqliteMigration with targetId="sqlite"', () => {
      const planner = createSqliteMigrationPlanner();
      const result = planner.plan({
        contract: createContract(),
        schema: emptySchema,
        policy: { allowedOperationClasses: ['additive'] },
        fromHash: coreHash('sha256:from'),
        frameworkComponents: [],
      });

      expect(result.kind).toBe('success');
      if (result.kind !== 'success') return;
      expect(result.plan.targetId).toBe('sqlite');
    });

    it('describe() returns the supplied from/to meta', () => {
      const planner = createSqliteMigrationPlanner();
      const contract = createContract();
      const result = planner.plan({
        contract: contract,
        schema: emptySchema,
        policy: { allowedOperationClasses: ['additive'] },
        fromHash: coreHash('sha256:from'),
        frameworkComponents: [],
      });

      if (result.kind !== 'success') throw new Error('expected success');
      const meta = result.plan.describe();
      expect(meta.from).toBe(coreHash('sha256:from'));
      expect(meta.to).toBe(contract.storage.storageHash);
    });

    it('destination carries both storageHash and profileHash from the contract', () => {
      const planner = createSqliteMigrationPlanner();
      const contract = createContract();
      const result = planner.plan({
        contract: contract,
        schema: emptySchema,
        policy: { allowedOperationClasses: ['additive'] },
        fromHash: '',
        frameworkComponents: [],
      });

      if (result.kind !== 'success') throw new Error('expected success');
      expect(result.plan.destination).toEqual({
        storageHash: contract.storage.storageHash,
        profileHash: contract.profileHash,
      });
    });

    it('operations getter renders the IR via toOp() in emission order', () => {
      const planner = createSqliteMigrationPlanner();
      const result = planner.plan({
        contract: createContract(),
        schema: emptySchema,
        policy: { allowedOperationClasses: ['additive'] },
        fromHash: '',
        frameworkComponents: [],
      });

      if (result.kind !== 'success') throw new Error('expected success');
      const ops = result.plan.operations;
      expect(ops).toHaveLength(1);
      expect(ops[0]?.id).toBe('table.user');
      expect(ops[0]?.operationClass).toBe('additive');
    });

    it('renderTypeScript() emits a class-flow scaffold with target-sqlite/migration import', () => {
      const planner = createSqliteMigrationPlanner();
      const result = planner.plan({
        contract: createContract(),
        schema: emptySchema,
        policy: { allowedOperationClasses: ['additive'] },
        fromHash: coreHash('sha256:from'),
        frameworkComponents: [],
      });

      if (result.kind !== 'success') throw new Error('expected success');
      const source = result.plan.renderTypeScript();
      expect(source).toContain("from '@prisma-next/target-sqlite/migration'");
      expect(source).toMatch(/\bMigration\b/);
      expect(source).toContain('export default class M extends Migration');
      expect(source).toContain(`from: "${coreHash('sha256:from')}"`);
      expect(source).toContain(`to: "${createContract().storage.storageHash}"`);
      expect(source).toContain('createTable(');
    });
  });

  describe('emptyMigration(context)', () => {
    it("identifies as the 'sqlite' target with no operations and the supplied destination hash", () => {
      const planner = createSqliteMigrationPlanner();
      const empty = planner.emptyMigration({
        packageDir: '/tmp/migration-pkg',
        fromHash: '',
        toHash: 'sha256:to',
      });

      expect(empty.targetId).toBe('sqlite');
      expect(empty.operations).toEqual([]);
      expect(empty.destination).toEqual({ storageHash: 'sha256:to' });
    });

    it('renders a stub whose describe() carries from/to and whose operations list is empty', () => {
      const planner = createSqliteMigrationPlanner();
      const empty = planner.emptyMigration({
        packageDir: '/tmp/migration-pkg',
        fromHash: 'sha256:from',
        toHash: 'sha256:to',
      });

      const source = empty.renderTypeScript();
      expect(source).toContain("from '@prisma-next/target-sqlite/migration'");
      expect(source).toContain('export default class M extends Migration');
      expect(source).toContain('from: "sha256:from"');
      expect(source).toContain('to: "sha256:to"');
      expect(source).toContain('override get operations()');
    });
  });

  describe('policy violations', () => {
    it('returns failure when policy excludes "additive"', () => {
      const planner = createSqliteMigrationPlanner();
      const result = planner.plan({
        contract: createContract(),
        schema: emptySchema,
        policy: { allowedOperationClasses: ['widening', 'destructive'] },
        fromHash: '',
        frameworkComponents: [],
      });

      expect(result.kind).toBe('failure');
      if (result.kind !== 'failure') return;
      expect(result.conflicts[0]?.kind).toBe('unsupportedOperation');
      expect(result.conflicts[0]?.summary).toContain('additive');
    });
  });
});
