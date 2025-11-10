import type { ParamDescriptor } from '@prisma-next/contract/types';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract-types';
import { param } from '@prisma-next/sql-relational-core/param';
import type { BinaryBuilder } from '@prisma-next/sql-relational-core/types';
import type { OperationExpr } from '@prisma-next/sql-target';
import { describe, expect, it } from 'vitest';
import { buildWhereExpr } from '../../src/selection/predicates';

describe('predicates', () => {
  const contract: SqlContract<SqlStorage> = {
    schemaVersion: '1',
    target: 'postgres',
    targetFamily: 'sql',
    coreHash: 'sha256:test',
    models: {},
    storage: {
      tables: {
        user: {
          columns: {
            id: { type: 'pg/int4@1', nullable: false },
            email: { type: 'pg/text@1', nullable: true },
          },
          primaryKey: { columns: ['id'] },
          uniques: [],
          indexes: [],
          foreignKeys: [],
        },
      },
    },
    relations: {},
    mappings: {
      modelToTable: {},
      tableToModel: {},
      fieldToColumn: {},
      columnToField: {},
      codecTypes: {},
      operationTypes: {},
    },
    meta: {},
    sources: {},
  };

  describe('buildWhereExpr', () => {
    it('builds where expr with column builder', () => {
      const where: BinaryBuilder = {
        left: {
          table: 'user',
          column: 'id',
          columnMeta: { type: 'pg/int4@1', nullable: false },
        },
        right: param('userId'),
        op: 'eq',
      };
      const paramsMap = { userId: 1 };
      const descriptors: ParamDescriptor[] = [];
      const values: unknown[] = [];

      const result = buildWhereExpr(where, contract, paramsMap, descriptors, values);

      expect(result.expr.kind).toBe('bin');
      expect(result.expr.op).toBe('eq');
      expect(result.expr.left.kind).toBe('col');
      expect(result.expr.left.table).toBe('user');
      expect(result.expr.left.column).toBe('id');
      expect(result.expr.right.kind).toBe('param');
      expect(result.paramName).toBe('userId');
      expect(result.codecId).toBe('pg/int4@1');
      expect(values).toEqual([1]);
      expect(descriptors).toHaveLength(1);
      expect(descriptors[0]?.name).toBe('userId');
      expect(descriptors[0]?.source).toBe('dsl');
      expect(descriptors[0]?.refs).toEqual({ table: 'user', column: 'id' });
      expect(descriptors[0]?.type).toBe('pg/int4@1');
      expect(descriptors[0]?.nullable).toBe(false);
    });

    it('builds where expr with nullable column', () => {
      const where: BinaryBuilder = {
        left: {
          table: 'user',
          column: 'email',
          columnMeta: { type: 'pg/text@1', nullable: true },
        },
        right: param('userEmail'),
        op: 'eq',
      };
      const paramsMap = { userEmail: 'test@example.com' };
      const descriptors: ParamDescriptor[] = [];
      const values: unknown[] = [];

      const result = buildWhereExpr(where, contract, paramsMap, descriptors, values);

      expect(result.codecId).toBe('pg/text@1');
      expect(descriptors[0]?.nullable).toBe(true);
    });

    it('builds where expr with operation expr', () => {
      const operationExpr: OperationExpr = {
        kind: 'operation',
        op: 'add',
        self: {
          kind: 'col',
          table: 'user',
          column: 'id',
        },
        args: [],
      };
      const where: BinaryBuilder = {
        left: {
          _operationExpr: operationExpr,
        } as unknown as BinaryBuilder['left'],
        right: param('userId'),
        op: 'eq',
      };
      const paramsMap = { userId: 1 };
      const descriptors: ParamDescriptor[] = [];
      const values: unknown[] = [];

      const result = buildWhereExpr(where, contract, paramsMap, descriptors, values);

      expect(result.expr.left.kind).toBe('operation');
      expect(result.codecId).toBeUndefined();
      expect(descriptors).toHaveLength(0);
    });

    it('builds where expr without codecId when column not found in contract', () => {
      const where: BinaryBuilder = {
        left: {
          table: 'user',
          column: 'unknown',
          columnMeta: {},
        },
        right: param('value'),
        op: 'eq',
      };
      const paramsMap = { value: 'test' };
      const descriptors: ParamDescriptor[] = [];
      const values: unknown[] = [];

      const result = buildWhereExpr(where, contract, paramsMap, descriptors, values);

      expect(result.codecId).toBeUndefined();
    });

    it('builds where expr without type in descriptor when columnMeta.type is missing', () => {
      const where: BinaryBuilder = {
        left: {
          table: 'user',
          column: 'id',
          columnMeta: {},
        },
        right: param('userId'),
        op: 'eq',
      };
      const paramsMap = { userId: 1 };
      const descriptors: ParamDescriptor[] = [];
      const values: unknown[] = [];

      buildWhereExpr(where, contract, paramsMap, descriptors, values);

      expect(descriptors[0]?.type).toBeUndefined();
    });

    it('builds where expr without nullable in descriptor when columnMeta.nullable is missing', () => {
      const where: BinaryBuilder = {
        left: {
          table: 'user',
          column: 'id',
          columnMeta: { type: 'pg/int4@1' },
        },
        right: param('userId'),
        op: 'eq',
      };
      const paramsMap = { userId: 1 };
      const descriptors: ParamDescriptor[] = [];
      const values: unknown[] = [];

      buildWhereExpr(where, contract, paramsMap, descriptors, values);

      expect(descriptors[0]?.nullable).toBeUndefined();
    });

    it('throws error when parameter is missing', () => {
      const where: BinaryBuilder = {
        left: {
          table: 'user',
          column: 'id',
        },
        right: param('missingParam'),
        op: 'eq',
      };
      const paramsMap = {};
      const descriptors: ParamDescriptor[] = [];
      const values: unknown[] = [];

      expect(() => buildWhereExpr(where, contract, paramsMap, descriptors, values)).toThrow(
        'Missing value for parameter missingParam',
      );
    });

    it('builds where expr with codecId from contract column', () => {
      const where: BinaryBuilder = {
        left: {
          table: 'user',
          column: 'id',
          columnMeta: {},
        },
        right: param('userId'),
        op: 'eq',
      };
      const paramsMap = { userId: 1 };
      const descriptors: ParamDescriptor[] = [];
      const values: unknown[] = [];

      const result = buildWhereExpr(where, contract, paramsMap, descriptors, values);

      expect(result.codecId).toBe('pg/int4@1');
    });
  });
});
