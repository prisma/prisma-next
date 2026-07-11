import { diffSchemas } from '@prisma-next/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import type { SqlSchemaIRNode } from '@prisma-next/sql-schema-ir/types';
import { describe, expect, it } from 'vitest';
import {
  PostgresDatabaseSchemaNode,
  type PostgresDatabaseSchemaNodeInput,
} from '../src/core/schema-ir/postgres-database-schema-node';
import { PostgresNamespaceSchemaNode } from '../src/core/schema-ir/postgres-namespace-schema-node';
import { PostgresRoleSchemaNode } from '../src/core/schema-ir/postgres-role-schema-node';
import { PostgresTableSchemaNode } from '../src/core/schema-ir/postgres-table-schema-node';
import type { SqlSchemaDiffNode } from '../src/core/schema-ir/schema-node-kinds';

const tableA = new PostgresTableSchemaNode({
  name: 'profiles',
  columns: { id: { name: 'id', nativeType: 'int4', nullable: false } },
  foreignKeys: [],
  uniques: [],
  indexes: [],
  policies: [],
  rlsEnabled: false,
});

const nsPublic = new PostgresNamespaceSchemaNode({
  schemaName: 'public',
  tables: { profiles: tableA },
  nativeEnumTypeNames: [],
});

const nsApp = new PostgresNamespaceSchemaNode({
  schemaName: 'app',
  tables: {},
  nativeEnumTypeNames: [],
});

const role = new PostgresRoleSchemaNode({
  name: 'app_user',
  namespaceId: UNBOUND_NAMESPACE_ID,
});

const baseInput: PostgresDatabaseSchemaNodeInput = {
  namespaces: { public: nsPublic, app: nsApp },
  roles: [role],
  existingSchemas: ['public', 'app'],
  pgVersion: '15.2',
};

describe('PostgresDatabaseSchemaNode', () => {
  it('id returns fixed sentinel "database"', () => {
    const node = new PostgresDatabaseSchemaNode(baseInput);
    expect(node.id).toBe('database');
  });

  it('isEqualTo matches by id (roots always share the "database" id)', () => {
    const a = new PostgresDatabaseSchemaNode(baseInput);
    const b = new PostgresDatabaseSchemaNode({ ...baseInput, pgVersion: '16.0' });
    expect(a.isEqualTo(b)).toBe(true);
  });

  it('children() yields namespace nodes followed by role nodes', () => {
    const node = new PostgresDatabaseSchemaNode(baseInput);
    expect(node.children()).toEqual([nsPublic, nsApp, role]);
  });

  it('children() includes role nodes (roles now enter the diff)', () => {
    const node = new PostgresDatabaseSchemaNode(baseInput);
    const roleChildren = node
      .children()
      .filter((child) => PostgresRoleSchemaNode.is(child as SqlSchemaDiffNode));
    expect(roleChildren).toEqual([role]);
  });

  it('a role id is namespaced away from schema ids so a role and a same-named schema never collide', () => {
    // The differ keys a parent's children into one flat id→node map and throws
    // on a duplicate id. A role and a schema may share a name (`public`), so
    // the role id must carry a sigil that no namespace id can equal.
    const publicRole = new PostgresRoleSchemaNode({
      name: 'public',
      namespaceId: UNBOUND_NAMESPACE_ID,
    });
    expect(publicRole.id).not.toBe(nsPublic.id);
    expect(publicRole.id).not.toBe('public');
    expect(publicRole.id.endsWith('public')).toBe(true);
  });

  it('diffs a role alongside a same-named schema without the duplicate-id throw', () => {
    // Root with a schema named `public` AND a role named `public`. Before the
    // sigil, both children would key to `public` and the differ would throw.
    const collidingRole = new PostgresRoleSchemaNode({
      name: 'public',
      namespaceId: UNBOUND_NAMESPACE_ID,
    });
    const expected = new PostgresDatabaseSchemaNode({
      namespaces: { public: nsPublic },
      roles: [collidingRole],
      existingSchemas: ['public'],
      pgVersion: '15.2',
    });
    const actual = new PostgresDatabaseSchemaNode({
      namespaces: { public: nsPublic },
      roles: [collidingRole],
      existingSchemas: ['public'],
      pgVersion: '15.2',
    });
    // No throw, and identical trees produce no issues.
    expect(() => diffSchemas(expected, actual)).not.toThrow();
    expect(diffSchemas(expected, actual)).toEqual([]);
  });

  it('carries namespaces keyed by schema name', () => {
    const node = new PostgresDatabaseSchemaNode(baseInput);
    expect(Object.keys(node.namespaces)).toEqual(['public', 'app']);
    expect(node.namespaces['public']).toBe(nsPublic);
  });

  it('carries roles', () => {
    const node = new PostgresDatabaseSchemaNode(baseInput);
    expect(node.roles).toEqual([role]);
  });

  it('carries existingSchemas', () => {
    const node = new PostgresDatabaseSchemaNode(baseInput);
    expect(node.existingSchemas).toEqual(['public', 'app']);
  });

  it('carries pgVersion', () => {
    const node = new PostgresDatabaseSchemaNode(baseInput);
    expect(node.pgVersion).toBe('15.2');
  });

  it('instance is frozen', () => {
    const node = new PostgresDatabaseSchemaNode(baseInput);
    expect(Object.isFrozen(node)).toBe(true);
  });

  it('nodeKind discriminant is "postgres-database"', () => {
    const node = new PostgresDatabaseSchemaNode(baseInput);
    expect(node.nodeKind).toBe('postgres-database');
  });

  describe('PostgresDatabaseSchemaNode.is', () => {
    it('returns true for a PostgresDatabaseSchemaNode', () => {
      const node = new PostgresDatabaseSchemaNode(baseInput);
      expect(PostgresDatabaseSchemaNode.is(node)).toBe(true);
    });

    it('returns true for a spread plain object that retains nodeKind', () => {
      const node = new PostgresDatabaseSchemaNode(baseInput);
      const spread = { ...node };
      expect(PostgresDatabaseSchemaNode.is(spread as unknown as SqlSchemaIRNode)).toBe(true);
    });

    it('returns false for a PostgresNamespaceSchemaNode', () => {
      expect(PostgresDatabaseSchemaNode.is(nsPublic as unknown as SqlSchemaIRNode)).toBe(false);
    });

    it('returns false for an object without nodeKind', () => {
      const bare = { id: 'database' } as unknown as SqlSchemaIRNode;
      expect(PostgresDatabaseSchemaNode.is(bare)).toBe(false);
    });
  });

  describe('PostgresDatabaseSchemaNode.assert', () => {
    it('does not throw for a valid node', () => {
      const node = new PostgresDatabaseSchemaNode(baseInput);
      expect(() => PostgresDatabaseSchemaNode.assert(node)).not.toThrow();
    });

    it('throws for an object with wrong nodeKind', () => {
      const bad = { nodeKind: 'postgres-namespace' } as unknown as SqlSchemaIRNode;
      expect(() => PostgresDatabaseSchemaNode.assert(bad)).toThrow();
    });
  });
});
