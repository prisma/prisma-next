import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import { describe, expect, it } from 'vitest';
import {
  PostgresDatabaseSchemaNode,
  type PostgresDatabaseSchemaNodeInput,
} from '../src/core/schema-ir/postgres-database-schema-node';
import { PostgresNamespaceSchemaNode } from '../src/core/schema-ir/postgres-namespace-schema-node';
import { PostgresRoleSchemaNode } from '../src/core/schema-ir/postgres-role-schema-node';
import { PostgresTableSchemaNode } from '../src/core/schema-ir/postgres-table-schema-node';

const tableA = new PostgresTableSchemaNode({
  name: 'profiles',
  columns: { id: { name: 'id', nativeType: 'int4', nullable: false } },
  foreignKeys: [],
  uniques: [],
  indexes: [],
  policies: [],
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

  it('isEqualTo always returns true', () => {
    const a = new PostgresDatabaseSchemaNode(baseInput);
    const b = new PostgresDatabaseSchemaNode({ ...baseInput, pgVersion: '16.0' });
    expect(a.isEqualTo(b)).toBe(true);
  });

  it('children() returns namespace nodes only (R4)', () => {
    const node = new PostgresDatabaseSchemaNode(baseInput);
    expect(node.children()).toEqual([nsPublic, nsApp]);
  });

  it('children() does not include roles (roles not diffed yet)', () => {
    const node = new PostgresDatabaseSchemaNode(baseInput);
    const children = node.children();
    for (const child of children) {
      expect(PostgresRoleSchemaNode.is(child)).toBe(false);
    }
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

  it('nodeTarget discriminant is "postgres"', () => {
    const node = new PostgresDatabaseSchemaNode(baseInput);
    expect(node.nodeTarget).toBe('postgres');
  });

  describe('PostgresDatabaseSchemaNode.is', () => {
    it('returns true for a PostgresDatabaseSchemaNode', () => {
      const node = new PostgresDatabaseSchemaNode(baseInput);
      expect(PostgresDatabaseSchemaNode.is(node)).toBe(true);
    });

    it('returns true for a spread plain object that retains nodeTarget', () => {
      const node = new PostgresDatabaseSchemaNode(baseInput);
      const spread = { ...node };
      expect(PostgresDatabaseSchemaNode.is(spread as unknown as PostgresDatabaseSchemaNode)).toBe(
        true,
      );
    });

    it('returns false for a PostgresNamespaceSchemaNode', () => {
      expect(PostgresDatabaseSchemaNode.is(nsPublic as unknown as PostgresDatabaseSchemaNode)).toBe(
        false,
      );
    });

    it('returns false for an object without nodeTarget', () => {
      const bare = { id: 'database' } as unknown as PostgresDatabaseSchemaNode;
      expect(PostgresDatabaseSchemaNode.is(bare)).toBe(false);
    });
  });

  describe('PostgresDatabaseSchemaNode.assert', () => {
    it('does not throw for a valid node', () => {
      const node = new PostgresDatabaseSchemaNode(baseInput);
      expect(() => PostgresDatabaseSchemaNode.assert(node)).not.toThrow();
    });

    it('throws for an object with wrong nodeTarget', () => {
      const bad = { nodeTarget: 'sql' } as unknown as PostgresDatabaseSchemaNode;
      expect(() => PostgresDatabaseSchemaNode.assert(bad)).toThrow();
    });
  });

  describe('PostgresDatabaseSchemaNode.ensure', () => {
    it('returns the same instance when already a real instance', () => {
      const node = new PostgresDatabaseSchemaNode(baseInput);
      expect(PostgresDatabaseSchemaNode.ensure(node)).toBe(node);
    });

    it('reconstructs from a spread-flattened plain object', () => {
      const node = new PostgresDatabaseSchemaNode(baseInput);
      const spread = { ...node } as unknown as PostgresDatabaseSchemaNode;
      const reconstructed = PostgresDatabaseSchemaNode.ensure(spread);
      expect(reconstructed).toBeInstanceOf(PostgresDatabaseSchemaNode);
      expect(reconstructed.id).toBe('database');
      expect(reconstructed.pgVersion).toBe('15.2');
      expect(Object.keys(reconstructed.namespaces)).toEqual(['public', 'app']);
    });
  });
});
