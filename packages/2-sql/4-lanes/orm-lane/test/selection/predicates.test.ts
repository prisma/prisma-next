import type { ParamDescriptor } from '@prisma-next/contract/types';
import type { SqlContract, SqlStorage, StorageColumn } from '@prisma-next/sql-contract/types';
import type { OperationExpr } from '@prisma-next/sql-relational-core/ast';
import { createColumnRef } from '@prisma-next/sql-relational-core/ast';
import { param } from '@prisma-next/sql-relational-core/param';
import { schema } from '@prisma-next/sql-relational-core/schema';
import type { BinaryBuilder } from '@prisma-next/sql-relational-core/types';
import { createStubAdapter, createTestContext } from '@prisma-next/sql-runtime/test/utils';
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
    storageHash: 'sha256:test' as never,
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
    capabilities: {},
    extensionPacks: {},
    meta: {},
    sources: {},
  };

  describe('buildWhereExpr', () => {
    it('builds where expr with column builder', () => {
      const adapter = createStubAdapter();
      const context = createTestContext(contract, adapter);
      const tables = schema(context).tables;
      const userTable = tables['user']!;
      const where = userTable.columns['id']!.eq(param('userId'));
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
      const adapter = createStubAdapter();
      const context = createTestContext(contract, adapter);
      const tables = schema(context).tables;
      const userTable = tables['user']!;
      const where = userTable.columns['email']!.eq(param('userEmail'));
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
      // Create an operation expression manually since schema().tables doesn't have operation methods
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
          template: '${self} + 1',
        },
      };

      // Create a binary builder with the operation expression as left side
      // This simulates what would happen if we called .eq() on a column with an operation
      const where = {
        kind: 'binary' as const,
        left: operationExpr,
        right: param('userId'),
        op: 'eq' as const,
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

    it('throws error when parameter is missing', () => {
      const adapter = createStubAdapter();
      const context = createTestContext(contract, adapter);
      const tables = schema(context).tables;
      const userTable = tables['user']!;
      const where = userTable.columns['id']!.eq(param('missingParam'));
      const paramsMap = {};
      const descriptors: ParamDescriptor[] = [];
      const values: unknown[] = [];

      expect(() => buildWhereExpr(where, contract, paramsMap, descriptors, values)).toThrow(
        'Missing value for parameter missingParam',
      );
    });

    it('builds where expr with column builder on right side', () => {
      const adapter = createStubAdapter();
      const context = createTestContext(contract, adapter);
      const tables = schema(context).tables;
      const userTable = tables['user']!;
      const where = userTable.columns['id']!.eq(userTable.columns['email']!);
      const paramsMap = {};
      const descriptors: ParamDescriptor[] = [];
      const values: unknown[] = [];

      const result = buildWhereExpr(where, contract, paramsMap, descriptors, values);

      expect({
        exprRightKind: result.expr.right.kind,
        exprRightTable: result.expr.right.kind === 'col' ? result.expr.right.table : undefined,
        exprRightColumn: result.expr.right.kind === 'col' ? result.expr.right.column : undefined,
        descriptorCount: descriptors.length,
      }).toMatchObject({
        exprRightKind: 'col',
        exprRightTable: 'user',
        exprRightColumn: 'email',
        descriptorCount: 0,
      });
    });

    it('throws error when where.right is neither param nor column builder', () => {
      const adapter = createStubAdapter();
      const context = createTestContext(contract, adapter);
      const tables = schema(context).tables;
      const userTable = tables['user']!;
      const idColumn = userTable.columns['id']!;

      // Create an invalid where clause with neither param nor column on right side
      const where = {
        kind: 'binary' as const,
        left: idColumn.toExpr(),
        right: { kind: 'invalid' } as unknown as ReturnType<typeof param>,
        op: 'eq' as const,
      } as unknown as BinaryBuilder;
      const paramsMap = {};
      const descriptors: ParamDescriptor[] = [];
      const values: unknown[] = [];

      expect(() => buildWhereExpr(where, contract, paramsMap, descriptors, values)).toThrow(
        'Failed to build WHERE clause',
      );
    });
  });
});
