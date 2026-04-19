import type {
  MigrationScaffoldContext,
  OperationDescriptor,
} from '@prisma-next/framework-components/control';
import { describe, expect, it } from 'vitest';
import { renderDescriptorTypeScript } from '../../src/core/migrations/scaffolding';

const PACKAGE_DIR = '/tmp/migration-pkg';

function renderPlan(
  plan: readonly OperationDescriptor[],
  overrides: Partial<MigrationScaffoldContext> = {},
): string {
  const context: MigrationScaffoldContext = {
    packageDir: PACKAGE_DIR,
    fromHash: '',
    toHash: '',
    ...overrides,
  };
  return renderDescriptorTypeScript(plan, context);
}

describe('renderDescriptorTypeScript', () => {
  describe('given an empty plan', () => {
    it('emits a stub file with a default createTable import', () => {
      expect(renderPlan([])).toBe(
        [
          'import { createTable } from "@prisma-next/target-postgres/migration-builders"',
          '',
          'export default () => []',
          '',
        ].join('\n'),
      );
    });
  });

  describe('given a DDL-only plan', () => {
    it('imports only the kinds used and renders each descriptor as a builder call', () => {
      const plan: readonly OperationDescriptor[] = [
        { kind: 'createTable', table: 'users' },
        {
          kind: 'addColumn',
          table: 'users',
          column: { name: 'email' },
          overrides: { nullable: true },
        },
      ];
      expect(renderPlan(plan)).toBe(
        [
          'import { createTable, addColumn } from "@prisma-next/target-postgres/migration-builders"',
          '',
          'export default () => [',
          '  createTable("users"),',
          '  addColumn("users", {"name":"email"}, {"nullable":true}),',
          ']',
          '',
        ].join('\n'),
      );
    });
  });

  describe('given a plan with a data transform and a contract path', () => {
    it('emits typed-contract builders via createBuilders<Contract>()', () => {
      const plan: readonly OperationDescriptor[] = [
        { kind: 'createTable', table: 'users' },
        { kind: 'dataTransform', name: 'backfill', check: null, run: null },
      ];
      expect(renderPlan(plan, { contractJsonPath: `${PACKAGE_DIR}/../contract.json` })).toBe(
        [
          'import type { Contract } from "../contract.d"',
          'import { createBuilders } from "@prisma-next/target-postgres/migration-builders"',
          '',
          'const { createTable, dataTransform, TODO } = createBuilders<Contract>()',
          '',
          'export default () => [',
          '  createTable("users"),',
          '  dataTransform("backfill", {',
          '    check: null,',
          '    run: null,',
          '  }),',
          ']',
          '',
        ].join('\n'),
      );
    });
  });

  describe('given a data-transform plan without a contract path', () => {
    it('falls back to the plain import with a TODO placeholder', () => {
      const plan: readonly OperationDescriptor[] = [
        { kind: 'dataTransform', name: 'backfill', check: Symbol('todo'), run: [Symbol('todo')] },
      ];
      expect(renderPlan(plan)).toBe(
        [
          'import { dataTransform, TODO } from "@prisma-next/target-postgres/migration-builders"',
          '',
          'export default () => [',
          '  dataTransform("backfill", {',
          '    check: TODO /* fill in using db.sql.from(...) */,',
          '    run: [TODO /* fill in using db.sql.from(...) */],',
          '  }),',
          ']',
          '',
        ].join('\n'),
      );
    });
  });

  describe('given an unknown descriptor kind', () => {
    it('throws with a Postgres-specific message', () => {
      expect(() =>
        renderPlan([{ kind: 'createCollection', collection: 'x' } as OperationDescriptor]),
      ).toThrow(/Unknown Postgres descriptor kind/);
    });
  });
});
