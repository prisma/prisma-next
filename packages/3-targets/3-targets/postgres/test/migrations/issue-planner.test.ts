import { type Contract, coreHash, profileHash } from '@prisma-next/contract/types';
import type { SchemaIssue } from '@prisma-next/framework-components/control';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import { describe, expect, it } from 'vitest';
import { planIssues } from '../../src/core/migrations/issue-planner';
import { renderCallsToTypeScript } from '../../src/core/migrations/render-typescript';

function makeContract(
  overrides: Partial<Contract<SqlStorage>['storage']> = {},
): Contract<SqlStorage> {
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('sha256:test'),
    storage: {
      storageHash: coreHash('sha256:contract'),
      tables: {},
      ...overrides,
    },
    roots: {},
    models: {},
    capabilities: {},
    extensionPacks: {},
    meta: {},
  };
}

const defaultCtx = {
  schemaName: 'public',
  codecHooks: new Map(),
  storageTypes: {},
};

describe('planIssues', () => {
  describe('missing_table', () => {
    it('emits CreateTableCall with columns', () => {
      const toContract = makeContract({
        tables: {
          user: {
            columns: {
              id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
              email: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      });
      const issues: SchemaIssue[] = [
        { kind: 'missing_table', table: 'user', message: 'Table "user" is missing' },
      ];

      const result = planIssues({
        ...defaultCtx,
        issues,
        toContract,
        fromContract: null,
        storageTypes: toContract.storage.types ?? {},
      });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('expected ok');
      expect(result.value.calls).toHaveLength(1);
      expect(result.value.calls[0]).toMatchObject({
        factoryName: 'createTable',
        tableName: 'user',
        operationClass: 'additive',
      });
    });
  });

  describe('notNullBackfill call strategy', () => {
    it('emits AddColumnCall(nullable) + DataTransformCall + SetNotNullCall', () => {
      const toContract = makeContract({
        tables: {
          user: {
            columns: {
              id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
              status: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      });
      const issues: SchemaIssue[] = [
        {
          kind: 'missing_column',
          table: 'user',
          column: 'status',
          message: 'Column "status" is missing',
        },
      ];

      const result = planIssues({
        ...defaultCtx,
        issues,
        toContract,
        fromContract: null,
        storageTypes: toContract.storage.types ?? {},
      });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('expected ok');
      const calls = result.value.calls;
      expect(calls).toHaveLength(3);
      expect(calls[0]).toMatchObject({ factoryName: 'addColumn' });
      expect(calls[1]).toMatchObject({ factoryName: 'dataTransform' });
      expect(calls[2]).toMatchObject({ factoryName: 'setNotNull' });
    });

    it('DataTransformCall.toOp() throws PN-MIG-2001', () => {
      const toContract = makeContract({
        tables: {
          user: {
            columns: {
              id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
              status: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      });
      const issues: SchemaIssue[] = [
        {
          kind: 'missing_column',
          table: 'user',
          column: 'status',
          message: 'Column "status" is missing',
        },
      ];

      const result = planIssues({
        ...defaultCtx,
        issues,
        toContract,
        fromContract: null,
        storageTypes: toContract.storage.types ?? {},
      });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('expected ok');
      const dtCall = result.value.calls[1]!;
      expect(dtCall.factoryName).toBe('dataTransform');
      expect(() => dtCall.toOp()).toThrow(expect.objectContaining({ code: '2001', domain: 'MIG' }));
    });
  });

  describe('nullableTightening call strategy', () => {
    it('emits DataTransformCall + SetNotNullCall', () => {
      const toContract = makeContract({
        tables: {
          user: {
            columns: {
              id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
              email: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      });
      const fromContract = makeContract({
        tables: {
          user: {
            columns: {
              id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
              email: { nativeType: 'text', codecId: 'pg/text@1', nullable: true },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      });
      const issues: SchemaIssue[] = [
        {
          kind: 'nullability_mismatch',
          table: 'user',
          column: 'email',
          expected: 'NOT NULL',
          actual: 'NULL',
          message: 'Column "email" nullability mismatch: expected NOT NULL, got NULL',
        },
      ];

      const result = planIssues({
        ...defaultCtx,
        issues,
        toContract,
        fromContract,
        storageTypes: toContract.storage.types ?? {},
      });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('expected ok');
      const calls = result.value.calls;
      expect(calls).toHaveLength(2);
      expect(calls[0]).toMatchObject({ factoryName: 'dataTransform' });
      expect(calls[1]).toMatchObject({ factoryName: 'setNotNull' });
    });
  });

  describe('typeChange call strategy', () => {
    it('emits AlterColumnTypeCall for safe widening', () => {
      const toContract = makeContract({
        tables: {
          user: {
            columns: {
              id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
              age: { nativeType: 'int8', codecId: 'pg/int8@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      });
      const fromContract = makeContract({
        tables: {
          user: {
            columns: {
              id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
              age: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      });
      const issues: SchemaIssue[] = [
        {
          kind: 'type_mismatch',
          table: 'user',
          column: 'age',
          expected: 'int8',
          actual: 'int4',
          message: 'Type mismatch on "age"',
        },
      ];

      const result = planIssues({
        ...defaultCtx,
        issues,
        toContract,
        fromContract,
        storageTypes: toContract.storage.types ?? {},
      });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('expected ok');
      const calls = result.value.calls;
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({ factoryName: 'alterColumnType' });
    });

    it('emits DataTransformCall + AlterColumnTypeCall for unsafe change', () => {
      const toContract = makeContract({
        tables: {
          user: {
            columns: {
              id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
              age: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      });
      const fromContract = makeContract({
        tables: {
          user: {
            columns: {
              id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
              age: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      });
      const issues: SchemaIssue[] = [
        {
          kind: 'type_mismatch',
          table: 'user',
          column: 'age',
          expected: 'text',
          actual: 'int4',
          message: 'Type mismatch on "age"',
        },
      ];

      const result = planIssues({
        ...defaultCtx,
        issues,
        toContract,
        fromContract,
        storageTypes: toContract.storage.types ?? {},
      });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('expected ok');
      const calls = result.value.calls;
      expect(calls).toHaveLength(2);
      expect(calls[0]).toMatchObject({ factoryName: 'dataTransform' });
      expect(calls[1]).toMatchObject({ factoryName: 'alterColumnType' });
    });
  });

  describe('enumChange call strategy', () => {
    it('emits AddEnumValuesCall for add-only', () => {
      const toContract = makeContract({
        tables: {},
        types: {
          status: {
            nativeType: 'status',
            codecId: 'pg/enum@1',
            typeParams: { values: ['active', 'inactive', 'archived'] },
          },
        },
      });
      const fromContract = makeContract({
        tables: {},
        types: {
          status: {
            nativeType: 'status',
            codecId: 'pg/enum@1',
            typeParams: { values: ['active', 'inactive'] },
          },
        },
      });
      const issues: SchemaIssue[] = [
        {
          kind: 'enum_values_changed',
          typeName: 'status',
          addedValues: ['archived'],
          removedValues: [],
          message: 'Enum "status" values changed',
        },
      ];

      const result = planIssues({
        ...defaultCtx,
        issues,
        toContract,
        fromContract,
        storageTypes: toContract.storage.types ?? {},
      });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('expected ok');
      const calls = result.value.calls;
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({ factoryName: 'addEnumValues' });
    });

    it('emits DataTransformCall + rebuild recipe for removal', () => {
      const toContract = makeContract({
        tables: {
          user: {
            columns: {
              id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
              status: {
                nativeType: 'status',
                codecId: 'pg/enum@1',
                nullable: false,
                typeRef: 'status',
              },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
        types: {
          status: {
            nativeType: 'status',
            codecId: 'pg/enum@1',
            typeParams: { values: ['active'] },
          },
        },
      });
      const fromContract = makeContract({
        tables: {
          user: {
            columns: {
              id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
              status: {
                nativeType: 'status',
                codecId: 'pg/enum@1',
                nullable: false,
                typeRef: 'status',
              },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
        types: {
          status: {
            nativeType: 'status',
            codecId: 'pg/enum@1',
            typeParams: { values: ['active', 'inactive'] },
          },
        },
      });
      const issues: SchemaIssue[] = [
        {
          kind: 'enum_values_changed',
          typeName: 'status',
          addedValues: [],
          removedValues: ['inactive'],
          message: 'Enum "status" values changed',
        },
      ];

      const result = planIssues({
        ...defaultCtx,
        issues,
        toContract,
        fromContract,
        storageTypes: toContract.storage.types ?? {},
      });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('expected ok');
      const calls = result.value.calls;
      expect(calls[0]).toMatchObject({ factoryName: 'dataTransform' });
      expect(calls[1]).toMatchObject({ factoryName: 'createEnumType' });
      expect(calls.some((c) => c.factoryName === 'dropEnumType')).toBe(true);
      expect(calls.some((c) => c.factoryName === 'renameType')).toBe(true);
    });
  });

  describe('strategies override', () => {
    it('bypasses data-safety strategies when strategies: [] is passed', () => {
      const toContract = makeContract({
        tables: {
          user: {
            columns: {
              id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
              status: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      });
      const issues: SchemaIssue[] = [
        {
          kind: 'missing_column',
          table: 'user',
          column: 'status',
          message: 'Column "status" is missing',
        },
      ];

      const result = planIssues({
        ...defaultCtx,
        issues,
        toContract,
        fromContract: null,
        storageTypes: toContract.storage.types ?? {},
        strategies: [],
      });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('expected ok');
      const calls = result.value.calls;
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({ factoryName: 'addColumn' });
      expect(calls.some((c) => c.factoryName === 'dataTransform')).toBe(false);
      expect(calls.some((c) => c.factoryName === 'setNotNull')).toBe(false);
    });
  });

  describe('renderTypeScript round-trip', () => {
    it('renders calls to valid TypeScript', () => {
      const toContract = makeContract({
        tables: {
          user: {
            columns: {
              id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
              status: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      });
      const issues: SchemaIssue[] = [
        {
          kind: 'missing_column',
          table: 'user',
          column: 'status',
          message: 'Column "status" is missing',
        },
      ];

      const result = planIssues({
        ...defaultCtx,
        issues,
        toContract,
        fromContract: null,
        storageTypes: toContract.storage.types ?? {},
      });
      if (!result.ok) throw new Error('expected ok');

      const ts = renderCallsToTypeScript(result.value.calls, {
        from: 'sha256:aaa',
        to: 'sha256:bbb',
      });

      expect(ts).toContain('class M extends Migration');
      expect(ts).toContain('addColumn(');
      expect(ts).toContain('dataTransform(');
      expect(ts).toContain('placeholder(');
      expect(ts).toContain('setNotNull(');
      expect(ts).toContain("import { Migration } from '@prisma-next/family-sql/migration'");
    });
  });
});
