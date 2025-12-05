import type { ParamDescriptor } from '@prisma-next/contract/types';
import type { SqlContract, SqlStorage, StorageColumn } from '@prisma-next/sql-contract/types';
import type { OperationExpr } from '@prisma-next/sql-relational-core/ast';
import { createColumnRef } from '@prisma-next/sql-relational-core/ast';
import { param } from '@prisma-next/sql-relational-core/param';
import type { BinaryBuilder } from '@prisma-next/sql-relational-core/types';
import { describe, expect, it } from 'vitest';
import { buildWhereExpr } from '../../src/selection/predicates';

describe('predicates', () => {
  const int4ColumnMeta: StorageColumn = {
    nativeType: 'int4',
    codecId: 'pg/int4@1',
    nullable: false,
  };
  const textColumnMeta: StorageColumn = {
    nativeType: 'text',
    codecId: 'pg/text@1',
    nullable: true,
  };

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
            id: int4ColumnMeta,
            email: textColumnMeta,
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
        kind: 'binary',
        left: {
          kind: 'column',
          table: 'user',
          column: 'id',
          columnMeta: int4ColumnMeta,
          eq: () => ({ kind: 'binary', op: 'eq', left: {} as unknown, right: {} as unknown }),
          asc: () => ({ kind: 'order', expr: {} as unknown, dir: 'asc' }),
          desc: () => ({ kind: 'order', expr: {} as unknown, dir: 'desc' }),
          __jsType: undefined,
        } as unknown as BinaryBuilder['left'],
        right: param('userId'),
        op: 'eq',
      };
      const paramsMap = { userId: 1 };
      const descriptors: ParamDescriptor[] = [];
      const values: unknown[] = [];

      const result = buildWhereExpr(where, contract, paramsMap, descriptors, values);

      expect({
        exprKind: result.expr.kind,
        exprOp: result.expr.op,
        exprLeft: result.expr.left,
        exprRightKind: result.expr.right.kind,
        paramName: result.paramName,
        codecId: result.codecId,
        values: values,
        descriptorCount: descriptors.length,
        descriptorName: descriptors[0]?.name,
        descriptorSource: descriptors[0]?.source,
        descriptorRefs: descriptors[0]?.refs,
        descriptorCodecId: descriptors[0]?.codecId,
        descriptorNativeType: descriptors[0]?.nativeType,
        descriptorNullable: descriptors[0]?.nullable,
      }).toMatchObject({
        exprKind: 'bin',
        exprOp: 'eq',
        exprLeft: { kind: 'col', table: 'user', column: 'id' },
        exprRightKind: 'param',
        paramName: 'userId',
        codecId: 'pg/int4@1',
        values: [1],
        descriptorCount: 1,
        descriptorName: 'userId',
        descriptorSource: 'dsl',
        descriptorRefs: { table: 'user', column: 'id' },
        descriptorCodecId: 'pg/int4@1',
        descriptorNativeType: 'int4',
        descriptorNullable: false,
      });
    });

    it('builds where expr with nullable column', () => {
      const where: BinaryBuilder = {
        kind: 'binary',
        left: {
          kind: 'column',
          table: 'user',
          column: 'email',
          columnMeta: textColumnMeta,
          eq: () => ({ kind: 'binary', op: 'eq', left: {} as unknown, right: {} as unknown }),
          asc: () => ({ kind: 'order', expr: {} as unknown, dir: 'asc' }),
          desc: () => ({ kind: 'order', expr: {} as unknown, dir: 'desc' }),
          __jsType: undefined,
        } as unknown as BinaryBuilder['left'],
        right: param('userEmail'),
        op: 'eq',
      };
      const paramsMap = { userEmail: 'test@example.com' };
      const descriptors: ParamDescriptor[] = [];
      const values: unknown[] = [];

      const result = buildWhereExpr(where, contract, paramsMap, descriptors, values);

      expect({
        codecId: result.codecId,
        nullable: descriptors[0]?.nullable,
      }).toMatchObject({
        codecId: 'pg/text@1',
        nullable: true,
      });
    });

    it('builds where expr with operation expr', () => {
      const operationExpr: OperationExpr = {
        kind: 'operation',
        method: 'add',
        forTypeId: 'pg/int4@1',
        self: createColumnRef('user', 'id'),
        args: [],
        returns: { kind: 'builtin', type: 'number' },
        lowering: {
          targetFamily: 'sql',
          strategy: 'infix',
          // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
          template: '${self} + ${arg0}',
        },
      };
      const where: BinaryBuilder = {
        kind: 'binary',
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

      expect({
        exprLeftKind: result.expr.left.kind,
        codecId: result.codecId,
        descriptorCount: descriptors.length,
      }).toMatchObject({
        exprLeftKind: 'operation',
        codecId: undefined,
        descriptorCount: 0,
      });
    });

    it('builds where expr without codecId when column not found in contract', () => {
      const where: BinaryBuilder = {
        kind: 'binary',
        left: {
          kind: 'column',
          table: 'user',
          column: 'unknown',
          columnMeta: int4ColumnMeta,
          eq: () => ({ kind: 'binary', op: 'eq', left: {} as unknown, right: {} as unknown }),
          asc: () => ({ kind: 'order', expr: {} as unknown, dir: 'asc' }),
          desc: () => ({ kind: 'order', expr: {} as unknown, dir: 'desc' }),
          __jsType: undefined,
        } as unknown as BinaryBuilder['left'],
        right: param('value'),
        op: 'eq',
      };
      const paramsMap = { value: 'test' };
      const descriptors: ParamDescriptor[] = [];
      const values: unknown[] = [];

      const result = buildWhereExpr(where, contract, paramsMap, descriptors, values);

      expect(result.codecId).toBeUndefined();
    });

    it('builds where expr with codecId from contract when columnMeta.codecId is missing', () => {
      const where: BinaryBuilder = {
        kind: 'binary',
        left: {
          kind: 'column',
          table: 'user',
          column: 'id',
          // @ts-expect-error - Testing fallback behavior with intentionally incomplete columnMeta
          columnMeta: { nullable: false } as unknown as StorageColumn,
          eq: () => ({ kind: 'binary', op: 'eq', left: {} as unknown, right: {} as unknown }),
          asc: () => ({ kind: 'order', expr: {} as unknown, dir: 'asc' }),
          desc: () => ({ kind: 'order', expr: {} as unknown, dir: 'desc' }),
          __jsType: undefined,
        } as unknown as BinaryBuilder['left'],
        right: param('userId'),
        op: 'eq',
      };
      const paramsMap = { userId: 1 };
      const descriptors: ParamDescriptor[] = [];
      const values: unknown[] = [];

      buildWhereExpr(where, contract, paramsMap, descriptors, values);

      // codecId and nativeType come from contract, not columnMeta
      expect(descriptors[0]?.codecId).toBe('pg/int4@1');
      expect(descriptors[0]?.nativeType).toBe('int4');
    });

    it('builds where expr without nullable in descriptor when columnMeta.nullable is missing', () => {
      const where: BinaryBuilder = {
        kind: 'binary',
        left: {
          kind: 'column',
          table: 'user',
          column: 'id',
          // @ts-expect-error - Testing fallback behavior with intentionally incomplete columnMeta
          columnMeta: { codecId: 'pg/int4@1' } as unknown as StorageColumn,
          eq: () => ({ kind: 'binary', op: 'eq', left: {} as unknown, right: {} as unknown }),
          asc: () => ({ kind: 'order', expr: {} as unknown, dir: 'asc' }),
          desc: () => ({ kind: 'order', expr: {} as unknown, dir: 'desc' }),
          __jsType: undefined,
        } as unknown as BinaryBuilder['left'],
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
        kind: 'binary',
        left: {
          kind: 'column',
          table: 'user',
          column: 'id',
          columnMeta: int4ColumnMeta,
          eq: () => ({ kind: 'binary', op: 'eq', left: {} as unknown, right: {} as unknown }),
          asc: () => ({ kind: 'order', expr: {} as unknown, dir: 'asc' }),
          desc: () => ({ kind: 'order', expr: {} as unknown, dir: 'desc' }),
          __jsType: undefined,
        } as unknown as BinaryBuilder['left'],
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
        kind: 'binary',
        left: {
          kind: 'column',
          table: 'user',
          column: 'id',
          columnMeta: int4ColumnMeta,
          eq: () => ({ kind: 'binary', op: 'eq', left: {} as unknown, right: {} as unknown }),
          asc: () => ({ kind: 'order', expr: {} as unknown, dir: 'asc' }),
          desc: () => ({ kind: 'order', expr: {} as unknown, dir: 'desc' }),
          __jsType: undefined,
        } as unknown as BinaryBuilder['left'],
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
