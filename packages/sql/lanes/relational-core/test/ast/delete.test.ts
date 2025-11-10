import type { BinaryExpr, ColumnRef, DeleteAst, TableRef } from '@prisma-next/sql-target';
import { describe, expect, it } from 'vitest';
import { createColumnRef, createParamRef, createTableRef } from '../../src/ast/common';
import { createDeleteAst } from '../../src/ast/delete';
import { createBinaryExpr } from '../../src/ast/predicate';

describe('ast/delete', () => {
  describe('createDeleteAst', () => {
    it('creates delete ast with table and where clause', () => {
      const table: TableRef = createTableRef('user');
      const where: BinaryExpr = createBinaryExpr(
        'eq',
        createColumnRef('user', 'id'),
        createParamRef(0, 'userId'),
      );

      const deleteAst = createDeleteAst({ table, where });

      expect(deleteAst).toEqual({
        kind: 'delete',
        table,
        where,
      });
      expect(deleteAst.kind).toBe('delete');
      expect(deleteAst.table).toBe(table);
      expect(deleteAst.where).toBe(where);
      expect(deleteAst.returning).toBeUndefined();
    });

    it('creates delete ast with returning clause', () => {
      const table: TableRef = createTableRef('user');
      const where: BinaryExpr = createBinaryExpr(
        'eq',
        createColumnRef('user', 'id'),
        createParamRef(0, 'userId'),
      );
      const returning: ColumnRef[] = [
        createColumnRef('user', 'id'),
        createColumnRef('user', 'email'),
      ];

      const deleteAst = createDeleteAst({ table, where, returning });

      expect(deleteAst).toEqual({
        kind: 'delete',
        table,
        where,
        returning,
      });
      expect(deleteAst.returning).toBe(returning);
      expect(deleteAst.returning).toHaveLength(2);
    });

    it('creates delete ast without returning clause', () => {
      const table: TableRef = createTableRef('post');
      const where: BinaryExpr = createBinaryExpr(
        'eq',
        createColumnRef('post', 'id'),
        createParamRef(0, 'postId'),
      );

      const deleteAst = createDeleteAst({ table, where });

      expect(deleteAst.returning).toBeUndefined();
    });

    it('creates delete ast with single returning column', () => {
      const table: TableRef = createTableRef('user');
      const where: BinaryExpr = createBinaryExpr(
        'eq',
        createColumnRef('user', 'id'),
        createParamRef(0, 'userId'),
      );
      const returning: ColumnRef[] = [createColumnRef('user', 'id')];

      const deleteAst = createDeleteAst({ table, where, returning });

      expect(deleteAst.returning).toHaveLength(1);
      expect(deleteAst.returning?.[0]).toEqual(createColumnRef('user', 'id'));
    });
  });
});
