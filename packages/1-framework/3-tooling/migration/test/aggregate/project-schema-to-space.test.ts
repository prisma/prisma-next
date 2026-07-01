import type { StorageBase } from '@prisma-next/contract/types';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import { createContract, createSqlContract } from '@prisma-next/test-utils';
import { describe, expect, it } from 'vitest';
import {
  collectOwnedNames,
  projectSchemaToSpace,
} from '../../src/aggregate/project-schema-to-space';
import type { ContractSpaceMember } from '../../src/aggregate/types';
import { makeContractSpaceMember } from '../fixtures';

type MongoStorageLike = StorageBase & {
  readonly namespaces: Record<
    string,
    {
      readonly id: string;
      readonly kind: string;
      readonly entries: { readonly collection: Record<string, unknown> };
    }
  >;
};

/**
 * `projectSchemaToSpace` is target-agnostic: it collects the entity names owned
 * by the other members from their contract storage, then delegates the actual
 * schema pruning to a family-provided callback. It never inspects the
 * introspected schema shape (that lives in the SQL / Mongo family
 * `schema-shape` modules and is tested there).
 */
describe('projectSchemaToSpace', () => {
  function memberWithTables(spaceId: string, tables: Record<string, unknown>): ContractSpaceMember {
    return makeContractSpaceMember({
      spaceId,
      contract: createSqlContract({
        storage: {
          namespaces: {
            [UNBOUND_NAMESPACE_ID]: {
              id: UNBOUND_NAMESPACE_ID,
              entries: { table: tables },
            },
          },
        },
      }),
    });
  }

  function memberWithCollections(
    spaceId: string,
    collections: Record<string, unknown>,
  ): ContractSpaceMember {
    return makeContractSpaceMember({
      spaceId,
      contract: createContract<MongoStorageLike>({
        target: 'mongo',
        targetFamily: 'mongo',
        storage: {
          namespaces: {
            [UNBOUND_NAMESPACE_ID]: {
              id: UNBOUND_NAMESPACE_ID,
              kind: 'mongo-namespace',
              entries: { collection: collections },
            },
          },
        },
      }),
    });
  }

  // The callback the framework never implements; the test supplies a trivial
  // one that records what it was handed, so we assert on the framework's
  // target-agnostic behaviour rather than any storage shape.
  const passthrough = (schema: unknown) => schema;

  describe('zero-cost path (does not invoke the callback)', () => {
    it('returns the schema verbatim when the other-members list is empty', () => {
      const schema = { tables: { user: {} } };
      const member = memberWithTables('app', { user: {} });
      let called = false;
      const result = projectSchemaToSpace(schema, member, [], (s) => {
        called = true;
        return s;
      });
      expect(result).toBe(schema);
      expect(called).toBe(false);
    });

    it('returns the schema verbatim when other-members contains only the projection target', () => {
      const schema = { tables: { user: {} } };
      const member = memberWithTables('app', { user: {} });
      let called = false;
      projectSchemaToSpace(schema, member, [member], (s) => {
        called = true;
        return s;
      });
      expect(called).toBe(false);
    });
  });

  describe('delegation', () => {
    it('invokes the callback with the schema and the names owned by other members', () => {
      const schema = { tables: { app_user: {} } };
      const member = memberWithTables('app', { app_user: {} });
      const others = [
        memberWithTables('audit', { ext_audit_log: {} }),
        memberWithTables('flags', { ext_feature_flag: {} }),
      ];
      let seenSchema: unknown;
      let seenNames: ReadonlySet<string> | undefined;
      projectSchemaToSpace(schema, member, others, (s, names) => {
        seenSchema = s;
        seenNames = names;
        return s;
      });
      expect(seenSchema).toBe(schema);
      expect([...(seenNames ?? [])].sort()).toEqual(['ext_audit_log', 'ext_feature_flag']);
    });

    it('returns whatever the callback returns', () => {
      const schema = { tables: { app_user: {}, ext_owned: {} } };
      const pruned = { tables: { app_user: {} } };
      const member = memberWithTables('app', { app_user: {} });
      const others = [memberWithTables('ext', { ext_owned: {} })];
      const result = projectSchemaToSpace(schema, member, others, () => pruned);
      expect(result).toBe(pruned);
    });

    it('excludes the projection target itself when it appears in other-members', () => {
      const schema = { tables: { app_user: {}, ext_owned: {} } };
      const member = memberWithTables('app', { app_user: {} });
      const others = [member, memberWithTables('ext', { ext_owned: {} })];
      let seenNames: ReadonlySet<string> | undefined;
      projectSchemaToSpace(schema, member, others, (s, names) => {
        seenNames = names;
        return s;
      });
      expect([...(seenNames ?? [])]).toEqual(['ext_owned']);
    });
  });

  describe('collectOwnedNames', () => {
    it('collects table names from SQL-shaped other-member contracts', () => {
      const member = memberWithTables('app', { app_user: {} });
      const others = [memberWithTables('ext', { ext_a: {}, ext_b: {} })];
      expect([...collectOwnedNames(member, others)].sort()).toEqual(['ext_a', 'ext_b']);
    });

    it('collects collection names from Mongo-shaped other-member contracts', () => {
      const member = memberWithCollections('app', { users: {} });
      const others = [memberWithCollections('ext', { cipher_state: {} })];
      expect([...collectOwnedNames(member, others)]).toEqual(['cipher_state']);
    });

    it('returns an empty set when the only other member is the projection target', () => {
      const member = memberWithTables('app', { user: {} });
      expect(collectOwnedNames(member, [member]).size).toBe(0);
      // A callback-free projection with nothing owned returns the input.
      const schema = { tables: { user: {} } };
      expect(projectSchemaToSpace(schema, member, [member], passthrough)).toBe(schema);
    });
  });
});
