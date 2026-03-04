import { describe, expect, it } from 'vitest';
import {
  createColumnRef,
  createDefaultValueExpr,
  createParamRef,
  createTableRef,
} from '../../src/ast/common';
import { createInsertAst } from '../../src/ast/insert';
import type { ColumnRef, InsertValue, ParamRef, TableRef } from '../../src/ast/types';

describe('ast/insert', () => {
  describe('createInsertAst', () => {
    it('creates insert ast with table and values', () => {
      const table: TableRef = createTableRef('user');
      const values: Record<string, ColumnRef | ParamRef> = {
        id: createParamRef(0, 'id'),
        email: createParamRef(1, 'email'),
      };

      const insertAst = createInsertAst({ table, rows: [values] });

      expect(insertAst).toEqual({
        kind: 'insert',
        table,
        rows: [values],
      });
      expect(insertAst.kind).toBe('insert');
      expect(insertAst.table).toBe(table);
      expect(insertAst.rows).toEqual([values]);
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

      const insertAst = createInsertAst({ table, rows: [values], returning });

      expect(insertAst).toEqual({
        kind: 'insert',
        table,
        rows: [values],
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

      const insertAst = createInsertAst({ table, rows: [values] });

      expect(insertAst.rows[0]).toEqual(values);
      expect(insertAst.rows[0]?.['id']).toEqual(createColumnRef('user', 'id'));
      expect(insertAst.rows[0]?.['email']).toEqual(createParamRef(0, 'email'));
    });

    it('creates insert ast without returning clause', () => {
      const table: TableRef = createTableRef('post');
      const values: Record<string, ColumnRef | ParamRef> = {
        title: createParamRef(0, 'title'),
        content: createParamRef(1, 'content'),
      };

      const insertAst = createInsertAst({ table, rows: [values] });

      expect(insertAst.returning).toBeUndefined();
    });

    it('creates insert ast with single returning column', () => {
      const table: TableRef = createTableRef('user');
      const values: Record<string, ColumnRef | ParamRef> = {
        id: createParamRef(0, 'id'),
      };
      const returning: ColumnRef[] = [createColumnRef('user', 'id')];

      const insertAst = createInsertAst({ table, rows: [values], returning });

      expect(insertAst.returning).toHaveLength(1);
      expect(insertAst.returning?.[0]).toEqual(createColumnRef('user', 'id'));
    });

    it('creates insert ast with empty values object', () => {
      const table: TableRef = createTableRef('user');
      const values: Record<string, InsertValue> = {};

      const insertAst = createInsertAst({ table, rows: [values] });

      expect(insertAst.rows).toEqual([{}]);
    });

    it('creates insert ast with multiple rows and explicit defaults', () => {
      const table: TableRef = createTableRef('user');
      const rows: ReadonlyArray<Record<string, InsertValue>> = [
        {
          id: createParamRef(0, 'id'),
          email: createParamRef(1, 'email'),
        },
        {
          id: createParamRef(2, 'id2'),
          email: createDefaultValueExpr(),
        },
      ];

      const insertAst = createInsertAst({ table, rows });

      expect(insertAst.rows).toEqual(rows);
      expect(insertAst.rows[1]?.['email']).toEqual(createDefaultValueExpr());
    });

    it('creates insert ast with onConflict update clause', () => {
      const table: TableRef = createTableRef('user');
      const values: Record<string, ColumnRef | ParamRef> = {
        id: createParamRef(0, 'id'),
        email: createParamRef(1, 'email'),
      };

      const insertAst = createInsertAst({
        table,
        rows: [values],
        onConflict: {
          columns: [createColumnRef('user', 'id')],
          action: {
            kind: 'doUpdateSet',
            set: { email: createParamRef(2, 'updatedEmail') },
          },
        },
      });

      expect(insertAst.onConflict).toEqual({
        columns: [createColumnRef('user', 'id')],
        action: {
          kind: 'doUpdateSet',
          set: { email: createParamRef(2, 'updatedEmail') },
        },
      });
    });
  });
});
