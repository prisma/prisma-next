import type { ParamDescriptor } from '@prisma-next/contract/types';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type { OperationExpr } from '@prisma-next/sql-relational-core/ast';
import { createColumnRef } from '@prisma-next/sql-relational-core/ast';
import { param } from '@prisma-next/sql-relational-core/param';
import type {
  AnyColumnBuilder,
  AnyPredicateBuilder,
  BinaryBuilder,
  LogicalBuilder,
} from '@prisma-next/sql-relational-core/types';
import { describe, expect, it } from 'vitest';
import { addLogicalMethodsToBinaryBuilder } from '../../../relational-core/src/logical-builder';
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

  // Helper to create mock column builder
  function createMockColumnBuilder(
    table: string,
    column: string,
    columnMeta: { type?: string; nullable?: boolean },
  ): AnyColumnBuilder {
    return {
      kind: 'column',
      table,
      column,
      columnMeta: columnMeta as { type: string; nullable: boolean },
      eq: () => ({ kind: 'binary', op: 'eq', left: {} as unknown, right: {} as unknown }),
      asc: () => ({ kind: 'order', expr: {} as unknown, dir: 'asc' }),
      desc: () => ({ kind: 'order', expr: {} as unknown, dir: 'desc' }),
      __jsType: undefined,
    } as unknown as AnyColumnBuilder;
  }

  // Helper to create mock binary builder with stub and/or methods
  function createMockBinaryBuilder(
    left: AnyColumnBuilder | OperationExpr,
    op: 'eq' | 'gt' | 'lt' | 'gte' | 'lte',
    right: { kind: 'param-placeholder'; name: string },
  ): BinaryBuilder {
    const binary: BinaryBuilder = {
      kind: 'binary',
      op,
      left,
      right,
      and(_expr: AnyPredicateBuilder): LogicalBuilder {
        throw new Error(
          'and() should not be called on mock BinaryBuilder - use addLogicalMethodsToBinaryBuilder',
        );
      },
      or(_expr: AnyPredicateBuilder): LogicalBuilder {
        throw new Error(
          'or() should not be called on mock BinaryBuilder - use addLogicalMethodsToBinaryBuilder',
        );
      },
    };
    return binary;
  }

  describe('buildWhereExpr', () => {
    it('builds where expr with column builder', () => {
      const columnBuilder = createMockColumnBuilder('user', 'id', {
        type: 'pg/int4@1',
        nullable: false,
      });
      const whereBase = createMockBinaryBuilder(columnBuilder, 'eq', param('userId'));
      const where = addLogicalMethodsToBinaryBuilder(whereBase);
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
        descriptorType: descriptors[0]?.type,
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
        descriptorType: 'pg/int4@1',
        descriptorNullable: false,
      });
    });

    it('builds where expr with nullable column', () => {
      const columnBuilder = createMockColumnBuilder('user', 'email', {
        type: 'pg/text@1',
        nullable: true,
      });
      const whereBase = createMockBinaryBuilder(columnBuilder, 'eq', param('userEmail'));
      const where = addLogicalMethodsToBinaryBuilder(whereBase);
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
      const columnBuilderWithOp = createMockColumnBuilder('user', 'id', {
        type: 'pg/int4@1',
        nullable: false,
      });
      (columnBuilderWithOp as { _operationExpr?: OperationExpr })._operationExpr = operationExpr;
      const whereBase = createMockBinaryBuilder(columnBuilderWithOp, 'eq', param('userId'));
      const where = addLogicalMethodsToBinaryBuilder(whereBase);
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
      const columnBuilder = createMockColumnBuilder('user', 'unknown', {
        type: 'pg/int4@1',
        nullable: false,
      });
      const whereBase = createMockBinaryBuilder(columnBuilder, 'eq', param('value'));
      const where = addLogicalMethodsToBinaryBuilder(whereBase);
      const paramsMap = { value: 'test' };
      const descriptors: ParamDescriptor[] = [];
      const values: unknown[] = [];

      const result = buildWhereExpr(where, contract, paramsMap, descriptors, values);

      expect(result.codecId).toBeUndefined();
    });

    it('builds where expr without type in descriptor when columnMeta.type is missing', () => {
      const columnBuilder = createMockColumnBuilder('user', 'id', { nullable: false });
      const whereBase = createMockBinaryBuilder(columnBuilder, 'eq', param('userId'));
      const where = addLogicalMethodsToBinaryBuilder(whereBase);
      const paramsMap = { userId: 1 };
      const descriptors: ParamDescriptor[] = [];
      const values: unknown[] = [];

      buildWhereExpr(where, contract, paramsMap, descriptors, values);

      expect(descriptors[0]?.type).toBeUndefined();
    });

    it('builds where expr without nullable in descriptor when columnMeta.nullable is missing', () => {
      const columnBuilder = createMockColumnBuilder('user', 'id', { type: 'pg/int4@1' });
      const whereBase = createMockBinaryBuilder(columnBuilder, 'eq', param('userId'));
      const where = addLogicalMethodsToBinaryBuilder(whereBase);
      const paramsMap = { userId: 1 };
      const descriptors: ParamDescriptor[] = [];
      const values: unknown[] = [];

      buildWhereExpr(where, contract, paramsMap, descriptors, values);

      expect(descriptors[0]?.nullable).toBeUndefined();
    });

    it('throws error when parameter is missing', () => {
      const columnBuilder = createMockColumnBuilder('user', 'id', {
        type: 'pg/int4@1',
        nullable: false,
      });
      const whereBase = createMockBinaryBuilder(columnBuilder, 'eq', param('missingParam'));
      const where = addLogicalMethodsToBinaryBuilder(whereBase);
      const paramsMap = {};
      const descriptors: ParamDescriptor[] = [];
      const values: unknown[] = [];

      expect(() => buildWhereExpr(where, contract, paramsMap, descriptors, values)).toThrow(
        'Missing value for parameter missingParam',
      );
    });

    it('builds where expr with codecId from contract column', () => {
      const columnBuilder = createMockColumnBuilder('user', 'id', {
        type: 'pg/int4@1',
        nullable: false,
      });
      const whereBase = createMockBinaryBuilder(columnBuilder, 'eq', param('userId'));
      const where = addLogicalMethodsToBinaryBuilder(whereBase);
      const paramsMap = { userId: 1 };
      const descriptors: ParamDescriptor[] = [];
      const values: unknown[] = [];

      const result = buildWhereExpr(where, contract, paramsMap, descriptors, values);

      expect(result.codecId).toBe('pg/int4@1');
    });

    it('builds logical expr with AND operator', () => {
      const idColumn = createMockColumnBuilder('user', 'id', {
        type: 'pg/int4@1',
        nullable: false,
      });
      const emailColumn = createMockColumnBuilder('user', 'email', {
        type: 'pg/text@1',
        nullable: true,
      });
      const where1 = addLogicalMethodsToBinaryBuilder(
        createMockBinaryBuilder(idColumn, 'eq', param('userId')),
      );
      const where2 = addLogicalMethodsToBinaryBuilder(
        createMockBinaryBuilder(emailColumn, 'eq', param('userEmail')),
      );
      const logicalWhere = where1.and(where2);
      const paramsMap = { userId: 1, userEmail: 'test@example.com' };
      const descriptors: ParamDescriptor[] = [];
      const values: unknown[] = [];

      const result = buildWhereExpr(logicalWhere, contract, paramsMap, descriptors, values);

      expect({
        exprKind: result.expr.kind,
        exprOp: result.expr.op,
        codecId: result.codecId,
      }).toMatchObject({
        exprKind: 'logical',
        exprOp: 'and',
        codecId: 'pg/int4@1', // Uses left codecId when both exist
      });
    });

    it('builds logical expr with OR operator', () => {
      const idColumn = createMockColumnBuilder('user', 'id', {
        type: 'pg/int4@1',
        nullable: false,
      });
      const emailColumn = createMockColumnBuilder('user', 'email', {
        type: 'pg/text@1',
        nullable: true,
      });
      const where1 = addLogicalMethodsToBinaryBuilder(
        createMockBinaryBuilder(idColumn, 'eq', param('userId')),
      );
      const where2 = addLogicalMethodsToBinaryBuilder(
        createMockBinaryBuilder(emailColumn, 'eq', param('userEmail')),
      );
      const logicalWhere = where1.or(where2);
      const paramsMap = { userId: 1, userEmail: 'test@example.com' };
      const descriptors: ParamDescriptor[] = [];
      const values: unknown[] = [];

      const result = buildWhereExpr(logicalWhere, contract, paramsMap, descriptors, values);

      expect({
        exprKind: result.expr.kind,
        exprOp: result.expr.op,
        codecId: result.codecId,
      }).toMatchObject({
        exprKind: 'logical',
        exprOp: 'or',
        codecId: 'pg/int4@1', // Uses left codecId when both exist
      });
    });

    it('builds logical expr with codecId from right side when left has no codecId', () => {
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
      const columnBuilderWithOp = createMockColumnBuilder('user', 'id', {
        type: 'pg/int4@1',
        nullable: false,
      });
      (columnBuilderWithOp as { _operationExpr?: OperationExpr })._operationExpr = operationExpr;
      const where1 = addLogicalMethodsToBinaryBuilder(
        createMockBinaryBuilder(columnBuilderWithOp, 'eq', param('value1')),
      );
      const emailColumn = createMockColumnBuilder('user', 'email', {
        type: 'pg/text@1',
        nullable: true,
      });
      const where2 = addLogicalMethodsToBinaryBuilder(
        createMockBinaryBuilder(emailColumn, 'eq', param('userEmail')),
      );
      const logicalWhere = where1.and(where2);
      const paramsMap = { value1: 1, userEmail: 'test@example.com' };
      const descriptors: ParamDescriptor[] = [];
      const values: unknown[] = [];

      const result = buildWhereExpr(logicalWhere, contract, paramsMap, descriptors, values);

      expect({
        exprKind: result.expr.kind,
        exprOp: result.expr.op,
        codecId: result.codecId,
      }).toMatchObject({
        exprKind: 'logical',
        exprOp: 'and',
        codecId: 'pg/text@1', // Uses right codecId when left has none
      });
    });

    it('builds logical expr without codecId when neither side has codecId', () => {
      const operationExpr1: OperationExpr = {
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
      const operationExpr2: OperationExpr = {
        kind: 'operation',
        method: 'subtract',
        forTypeId: 'pg/int4@1',
        self: createColumnRef('user', 'id'),
        args: [],
        returns: { kind: 'builtin', type: 'number' },
        lowering: {
          targetFamily: 'sql',
          strategy: 'infix',
          // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
          template: '${self} - ${arg0}',
        },
      };
      const columnBuilder1 = createMockColumnBuilder('user', 'id', {
        type: 'pg/int4@1',
        nullable: false,
      });
      (columnBuilder1 as { _operationExpr?: OperationExpr })._operationExpr = operationExpr1;
      const columnBuilder2 = createMockColumnBuilder('user', 'id', {
        type: 'pg/int4@1',
        nullable: false,
      });
      (columnBuilder2 as { _operationExpr?: OperationExpr })._operationExpr = operationExpr2;
      const where1 = addLogicalMethodsToBinaryBuilder(
        createMockBinaryBuilder(columnBuilder1, 'eq', param('value1')),
      );
      const where2 = addLogicalMethodsToBinaryBuilder(
        createMockBinaryBuilder(columnBuilder2, 'eq', param('value2')),
      );
      const logicalWhere = where1.and(where2);
      const paramsMap = { value1: 1, value2: 2 };
      const descriptors: ParamDescriptor[] = [];
      const values: unknown[] = [];

      const result = buildWhereExpr(logicalWhere, contract, paramsMap, descriptors, values);

      expect({
        exprKind: result.expr.kind,
        exprOp: result.expr.op,
        codecId: result.codecId,
      }).toMatchObject({
        exprKind: 'logical',
        exprOp: 'and',
        codecId: undefined, // Neither side has codecId
      });
    });

    it('builds nested logical expressions', () => {
      const idColumn = createMockColumnBuilder('user', 'id', {
        type: 'pg/int4@1',
        nullable: false,
      });
      const emailColumn = createMockColumnBuilder('user', 'email', {
        type: 'pg/text@1',
        nullable: true,
      });
      const where1 = addLogicalMethodsToBinaryBuilder(
        createMockBinaryBuilder(idColumn, 'eq', param('userId')),
      );
      const where2 = addLogicalMethodsToBinaryBuilder(
        createMockBinaryBuilder(emailColumn, 'eq', param('email1')),
      );
      const where3 = addLogicalMethodsToBinaryBuilder(
        createMockBinaryBuilder(emailColumn, 'eq', param('email2')),
      );
      const nestedLogical = where2.or(where3);
      const topLevelLogical = where1.and(nestedLogical);
      const paramsMap = { userId: 1, email1: 'test1@example.com', email2: 'test2@example.com' };
      const descriptors: ParamDescriptor[] = [];
      const values: unknown[] = [];

      const result = buildWhereExpr(topLevelLogical, contract, paramsMap, descriptors, values);

      expect(result.expr.kind).toBe('logical');
      expect(result.expr.op).toBe('and');
      expect(result.expr.right.kind).toBe('logical');
      if (result.expr.right.kind === 'logical') {
        expect(result.expr.right.op).toBe('or');
      }
    });

    it('builds where expr with gt operator', () => {
      const columnBuilder = createMockColumnBuilder('user', 'id', {
        type: 'pg/int4@1',
        nullable: false,
      });
      const whereBase = createMockBinaryBuilder(columnBuilder, 'gt', param('userId'));
      const where = addLogicalMethodsToBinaryBuilder(whereBase);
      const paramsMap = { userId: 1 };
      const descriptors: ParamDescriptor[] = [];
      const values: unknown[] = [];

      const result = buildWhereExpr(where, contract, paramsMap, descriptors, values);

      expect({
        exprKind: result.expr.kind,
        exprOp: result.expr.op,
      }).toMatchObject({
        exprKind: 'bin',
        exprOp: 'gt',
      });
    });

    it('builds where expr with lt operator', () => {
      const columnBuilder = createMockColumnBuilder('user', 'id', {
        type: 'pg/int4@1',
        nullable: false,
      });
      const whereBase = createMockBinaryBuilder(columnBuilder, 'lt', param('userId'));
      const where = addLogicalMethodsToBinaryBuilder(whereBase);
      const paramsMap = { userId: 1 };
      const descriptors: ParamDescriptor[] = [];
      const values: unknown[] = [];

      const result = buildWhereExpr(where, contract, paramsMap, descriptors, values);

      expect({
        exprKind: result.expr.kind,
        exprOp: result.expr.op,
      }).toMatchObject({
        exprKind: 'bin',
        exprOp: 'lt',
      });
    });

    it('builds where expr with gte operator', () => {
      const columnBuilder = createMockColumnBuilder('user', 'id', {
        type: 'pg/int4@1',
        nullable: false,
      });
      const whereBase = createMockBinaryBuilder(columnBuilder, 'gte', param('userId'));
      const where = addLogicalMethodsToBinaryBuilder(whereBase);
      const paramsMap = { userId: 1 };
      const descriptors: ParamDescriptor[] = [];
      const values: unknown[] = [];

      const result = buildWhereExpr(where, contract, paramsMap, descriptors, values);

      expect({
        exprKind: result.expr.kind,
        exprOp: result.expr.op,
      }).toMatchObject({
        exprKind: 'bin',
        exprOp: 'gte',
      });
    });

    it('builds where expr with lte operator', () => {
      const columnBuilder = createMockColumnBuilder('user', 'id', {
        type: 'pg/int4@1',
        nullable: false,
      });
      const whereBase = createMockBinaryBuilder(columnBuilder, 'lte', param('userId'));
      const where = addLogicalMethodsToBinaryBuilder(whereBase);
      const paramsMap = { userId: 1 };
      const descriptors: ParamDescriptor[] = [];
      const values: unknown[] = [];

      const result = buildWhereExpr(where, contract, paramsMap, descriptors, values);

      expect({
        exprKind: result.expr.kind,
        exprOp: result.expr.op,
      }).toMatchObject({
        exprKind: 'bin',
        exprOp: 'lte',
      });
    });

    it('builds where expr without codecId when table not found in contract', () => {
      const columnBuilder = createMockColumnBuilder('nonexistent', 'id', {
        type: 'pg/int4@1',
        nullable: false,
      });
      const whereBase = createMockBinaryBuilder(columnBuilder, 'eq', param('value'));
      const where = addLogicalMethodsToBinaryBuilder(whereBase);
      const paramsMap = { value: 'test' };
      const descriptors: ParamDescriptor[] = [];
      const values: unknown[] = [];

      const result = buildWhereExpr(where, contract, paramsMap, descriptors, values);

      expect(result.codecId).toBeUndefined();
    });
  });
});
