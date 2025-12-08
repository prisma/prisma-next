import { describe, expect, it } from 'vitest';
import { createColumnRef, createParamRef, createTableRef } from '../../src/ast/common';
import { createInsertAst } from '../../src/ast/insert';
import type { ColumnRef, ParamRef, TableRef } from '../../src/ast/types';

describe('ast/insert', () => {
  describe('createInsertAst', () => {
    it('creates insert ast with table and values', () => {
      const table: TableRef = createTableRef('user');
      const values: Record<string, ColumnRef | ParamRef> = {
        id: createParamRef(0, 'id'),
        email: createParamRef(1, 'email'),
      };

      const insertAst = createInsertAst({ table, values });

      expect(insertAst).toEqual({
        kind: 'insert',
        table,
        values,
      });
      expect(insertAst.kind).toBe('insert');
      expect(insertAst.table).toBe(table);
      expect(insertAst.values).toBe(values);
      expect(insertAst.returning).toBeUndefined();
    });

    it('creates insert ast with returning clause', () => {
      const table: TableRef = createTableRef('user');
      const values: Record<string, ColumnRef | ParamRef> = {
        id: createParamRef(0, 'id'),
        email: createParamRef(1, 'email'),
      };
      const returning: ColumnRef[] = [
        createColumnRef('user', 'id'),
        createColumnRef('user', 'email'),
      ];

      const insertAst = createInsertAst({ table, values, returning });

      expect(insertAst).toEqual({
        kind: 'insert',
        table,
        values,
        returning,
      });
      expect(insertAst.returning).toBe(returning);
      expect(insertAst.returning).toHaveLength(2);
    });

    it('creates insert ast with column refs in values', () => {
      const table: TableRef = createTableRef('user');
      const values: Record<string, ColumnRef | ParamRef> = {
        id: createColumnRef('user', 'id'),
        email: createParamRef(0, 'email'),
      };

      const insertAst = createInsertAst({ table, values });

      expect(insertAst.values).toBe(values);
      expect(insertAst.values['id']).toEqual(createColumnRef('user', 'id'));
      expect(insertAst.values['email']).toEqual(createParamRef(0, 'email'));
    });

    it('creates insert ast without returning clause', () => {
      const table: TableRef = createTableRef('post');
      const values: Record<string, ColumnRef | ParamRef> = {
        title: createParamRef(0, 'title'),
        content: createParamRef(1, 'content'),
      };

      const insertAst = createInsertAst({ table, values });

      expect(insertAst.returning).toBeUndefined();
    });

    it('creates insert ast with single returning column', () => {
      const table: TableRef = createTableRef('user');
      const values: Record<string, ColumnRef | ParamRef> = {
        id: createParamRef(0, 'id'),
      };
      const returning: ColumnRef[] = [createColumnRef('user', 'id')];

      const insertAst = createInsertAst({ table, values, returning });

      expect(insertAst.returning).toHaveLength(1);
      expect(insertAst.returning?.[0]).toEqual(createColumnRef('user', 'id'));
    });

    it('creates insert ast with empty values object', () => {
      const table: TableRef = createTableRef('user');
      const values: Record<string, ColumnRef | ParamRef> = {};

      const insertAst = createInsertAst({ table, values });

      expect(insertAst.values).toEqual({});
    });
  });
});
