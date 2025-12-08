import { describe, expect, it } from 'vitest';
import { createColumnRef, createParamRef, createTableRef } from '../../src/ast/common';
import { createBinaryExpr } from '../../src/ast/predicate';
import { createUpdateAst } from '../../src/ast/update';
import type { BinaryExpr, ColumnRef, ParamRef, TableRef } from '../../src/exports/ast';

describe('ast/update', () => {
  describe('createUpdateAst', () => {
    it('creates update ast with table, set, and where', () => {
      const table: TableRef = createTableRef('user');
      const set: Record<string, ColumnRef | ParamRef> = {
        email: createParamRef(0, 'email'),
      };
      const where: BinaryExpr = createBinaryExpr(
        'eq',
        createColumnRef('user', 'id'),
        createParamRef(1, 'userId'),
      );

      const updateAst = createUpdateAst({ table, set, where });

      expect(updateAst).toEqual({
        kind: 'update',
        table,
        set,
        where,
      });
      expect(updateAst.kind).toBe('update');
      expect(updateAst.table).toBe(table);
      expect(updateAst.set).toBe(set);
      expect(updateAst.where).toBe(where);
      expect(updateAst.returning).toBeUndefined();
    });

    it('creates update ast with returning clause', () => {
      const table: TableRef = createTableRef('user');
      const set: Record<string, ColumnRef | ParamRef> = {
        email: createParamRef(0, 'email'),
      };
      const where: BinaryExpr = createBinaryExpr(
        'eq',
        createColumnRef('user', 'id'),
        createParamRef(1, 'userId'),
      );
      const returning: ColumnRef[] = [
        createColumnRef('user', 'id'),
        createColumnRef('user', 'email'),
      ];

      const updateAst = createUpdateAst({ table, set, where, returning });

      expect(updateAst.returning).toBe(returning);
      expect(updateAst.returning).toHaveLength(2);
    });

    it('creates update ast with multiple set values', () => {
      const table: TableRef = createTableRef('user');
      const set: Record<string, ColumnRef | ParamRef> = {
        email: createParamRef(0, 'email'),
        name: createParamRef(1, 'name'),
      };
      const where: BinaryExpr = createBinaryExpr(
        'eq',
        createColumnRef('user', 'id'),
        createParamRef(2, 'userId'),
      );

      const updateAst = createUpdateAst({ table, set, where });

      expect(updateAst.set).toBe(set);
      expect(Object.keys(updateAst.set)).toHaveLength(2);
    });

    it('creates update ast with column refs in set', () => {
      const table: TableRef = createTableRef('user');
      const set: Record<string, ColumnRef | ParamRef> = {
        id: createColumnRef('user', 'id'),
        email: createParamRef(0, 'email'),
      };
      const where: BinaryExpr = createBinaryExpr(
        'eq',
        createColumnRef('user', 'id'),
        createParamRef(1, 'userId'),
      );

      const updateAst = createUpdateAst({ table, set, where });

      expect(updateAst.set['id']).toEqual(createColumnRef('user', 'id'));
      expect(updateAst.set['email']).toEqual(createParamRef(0, 'email'));
    });

    it('creates update ast without returning clause', () => {
      const table: TableRef = createTableRef('post');
      const set: Record<string, ColumnRef | ParamRef> = {
        title: createParamRef(0, 'title'),
      };
      const where: BinaryExpr = createBinaryExpr(
        'eq',
        createColumnRef('post', 'id'),
        createParamRef(1, 'postId'),
      );

      const updateAst = createUpdateAst({ table, set, where });

      expect(updateAst.returning).toBeUndefined();
    });

    it('creates update ast with single returning column', () => {
      const table: TableRef = createTableRef('user');
      const set: Record<string, ColumnRef | ParamRef> = {
        email: createParamRef(0, 'email'),
      };
      const where: BinaryExpr = createBinaryExpr(
        'eq',
        createColumnRef('user', 'id'),
        createParamRef(1, 'userId'),
      );
      const returning: ColumnRef[] = [createColumnRef('user', 'id')];

      const updateAst = createUpdateAst({ table, set, where, returning });

      expect(updateAst.returning).toHaveLength(1);
      expect(updateAst.returning?.[0]).toEqual(createColumnRef('user', 'id'));
    });

    it('creates update ast with empty set object', () => {
      const table: TableRef = createTableRef('user');
      const set: Record<string, ColumnRef | ParamRef> = {};
      const where: BinaryExpr = createBinaryExpr(
        'eq',
        createColumnRef('user', 'id'),
        createParamRef(0, 'userId'),
      );

      const updateAst = createUpdateAst({ table, set, where });

      expect(updateAst.set).toEqual({});
    });
  });
});
