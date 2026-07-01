import { describe, expect, it } from 'vitest';
import { sqlListSchemaEntityNames, sqlProjectSchemaToMember } from '../src/core/diff/schema-shape';

/**
 * The SQL family owns the introspected-schema shape (the framework aggregate
 * verifier/planner is shape-free). These callbacks walk a flat `tables` record
 * (SQLite) and a namespaced `namespaces[…].tables` tree (Postgres).
 */
describe('sqlProjectSchemaToMember', () => {
  describe('flat schema', () => {
    it('removes only tables owned by other members', () => {
      const schema = {
        tables: {
          app_user: { columns: { id: {} } },
          ext_audit_log: { columns: { id: {} } },
        },
      };
      const projected = sqlProjectSchemaToMember(schema, new Set(['ext_audit_log'])) as {
        readonly tables: Record<string, unknown>;
      };
      expect(Object.keys(projected.tables)).toEqual(['app_user']);
      expect(projected.tables['app_user']).toBe(schema.tables['app_user']);
    });

    it('preserves orphan tables owned by no member', () => {
      const orphan = { columns: {} };
      const schema = { tables: { app_user: {}, ext_owned: {}, orphan_table: orphan } };
      const projected = sqlProjectSchemaToMember(schema, new Set(['ext_owned'])) as {
        readonly tables: Record<string, unknown>;
      };
      expect(Object.keys(projected.tables).sort()).toEqual(['app_user', 'orphan_table']);
      expect(projected.tables['orphan_table']).toBe(orphan);
    });

    it('preserves non-`tables` fields', () => {
      const schema = { tables: { ext_owned: {}, app_user: {} }, meta: { dialect: 'postgres' } };
      const projected = sqlProjectSchemaToMember(schema, new Set(['ext_owned'])) as {
        readonly tables: Record<string, unknown>;
        readonly meta: unknown;
      };
      expect(Object.keys(projected.tables)).toEqual(['app_user']);
      expect(projected.meta).toBe(schema.meta);
    });

    it('returns the input unchanged when nothing is removed', () => {
      const schema = { tables: { app_user: {} } };
      expect(sqlProjectSchemaToMember(schema, new Set(['nope']))).toBe(schema);
    });
  });

  describe('namespaced tree', () => {
    it('prunes other-member tables within each namespace', () => {
      const schema = {
        nodeKind: 'postgres-database',
        namespaces: {
          public: { schemaName: 'public', tables: { app_user: {}, ext_owned: {} } },
          auth: { schemaName: 'auth', tables: { ext_session: {} } },
        },
      };
      const projected = sqlProjectSchemaToMember(schema, new Set(['ext_owned', 'ext_session'])) as {
        readonly namespaces: Record<string, { readonly tables: Record<string, unknown> }>;
      };
      expect(Object.keys(projected.namespaces['public']!.tables)).toEqual(['app_user']);
      expect(Object.keys(projected.namespaces['auth']!.tables)).toEqual([]);
    });

    it('returns the tree unchanged when nothing is removed', () => {
      const schema = {
        nodeKind: 'postgres-database',
        namespaces: { public: { schemaName: 'public', tables: { app_user: {} } } },
      };
      expect(sqlProjectSchemaToMember(schema, new Set(['ext_owned']))).toBe(schema);
    });
  });

  describe('fall-through', () => {
    it('returns non-object schemas verbatim', () => {
      expect(sqlProjectSchemaToMember(null, new Set(['x']))).toBe(null);
      expect(sqlProjectSchemaToMember(42, new Set(['x']))).toBe(42);
    });

    it('returns schemas without `tables`/`namespaces` unchanged', () => {
      const schema = { other: 'shape' };
      expect(sqlProjectSchemaToMember(schema, new Set(['x']))).toBe(schema);
    });
  });
});

describe('sqlListSchemaEntityNames', () => {
  it('lists top-level table names for a flat schema', () => {
    expect([...sqlListSchemaEntityNames({ tables: { a: {}, b: {} } })].sort()).toEqual(['a', 'b']);
  });

  it('gathers table names across namespaces for a tree', () => {
    const schema = {
      namespaces: {
        public: { tables: { app_user: {} } },
        auth: { tables: { session: {} } },
      },
    };
    expect([...sqlListSchemaEntityNames(schema)].sort()).toEqual(['app_user', 'session']);
  });

  it('returns none for an unrecognised shape', () => {
    expect(sqlListSchemaEntityNames({ other: 'shape' })).toEqual([]);
    expect(sqlListSchemaEntityNames(null)).toEqual([]);
  });
});
