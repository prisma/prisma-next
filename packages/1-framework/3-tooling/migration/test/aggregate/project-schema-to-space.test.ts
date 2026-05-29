import { createContract } from '@prisma-next/contract/testing';
import type { Contract, StorageBase } from '@prisma-next/contract/types';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import { describe, expect, it } from 'vitest';
import { projectSchemaToSpace } from '../../src/aggregate/project-schema-to-space';
import type { ContractSpaceMember } from '../../src/aggregate/types';
import { makeContractSpaceMember } from '../fixtures';

type MongoStorageLike = StorageBase & { readonly collections: Record<string, unknown> };

/**
 * Unit tests for the duck-typed schema projector used by the aggregate
 * planner (synth strategy) and the aggregate verifier (schemaCheck) to
 * project the introspected live schema down to the slice claimed by a
 * single contract-space member.
 *
 * Semantics:
 *
 * - `unknown` for schema; structural fall-through when shape doesn't match.
 * - Tables claimed by other members are stripped; everything else is
 *   identity-preserving.
 *
 * @see packages/1-framework/3-tooling/migration/src/aggregate/project-schema-to-space.ts
 */
describe('projectSchemaToSpace', () => {
  /**
   * Build a synthetic member with only the fields `projectSchemaToSpace`
   * inspects (`spaceId`, `contract.storage.namespaces[…].tables`). The rest is filled
   * with empty / sentinel values to satisfy the type without committing
   * to a particular family.
   */
  function memberWithTables(spaceId: string, tables: Record<string, unknown>): ContractSpaceMember {
    return makeContractSpaceMember({
      spaceId,
      contract: createContract({
        storage: {
          namespaces: {
            [UNBOUND_NAMESPACE_ID]: { id: UNBOUND_NAMESPACE_ID, tables },
          },
        },
      }),
    });
  }

  /**
   * Build a synthetic member whose contract storage is Mongo-shaped
   * (`collections: Record<string, _>`). The projector duck-types both
   * SQL (`tables`) and Mongo (`collections`) record-shaped storage on
   * the *other-member* side; this helper exercises the Mongo branch.
   */
  function memberWithCollections(
    spaceId: string,
    collections: Record<string, unknown>,
  ): ContractSpaceMember {
    return makeContractSpaceMember({
      spaceId,
      contract: createContract<MongoStorageLike>({
        target: 'mongo',
        targetFamily: 'mongo',
        storage: { collections },
      }),
    });
  }

  /**
   * Build a synthetic member whose contract's storage shape doesn't
   * match the duck-typed expectation. Used to verify the helper falls
   * through structurally (other members with malformed contracts
   * contribute zero owned tables).
   *
   * `unknown` cast: `projectSchemaToSpace` is duck-typed by design and
   * tolerates malformed `contract.storage`. The cast here lets us inject
   * intentionally-malformed shapes without bypassing the function's
   * typing in production callers (the rest of the codebase only ever
   * sees fully-validated `Contract` values).
   */
  function memberWithMalformedStorage(spaceId: string, storage: unknown): ContractSpaceMember {
    const baseContract = createContract();
    return makeContractSpaceMember({
      spaceId,
      contract: { ...baseContract, storage } as unknown as Contract,
    });
  }

  describe('duck-typing fall-through (returns input unchanged)', () => {
    it('returns scalar schemas verbatim', () => {
      const member = memberWithTables('app', {});
      expect(projectSchemaToSpace(null, member, [])).toBe(null);
      expect(projectSchemaToSpace(undefined, member, [])).toBe(undefined);
      expect(projectSchemaToSpace(42, member, [])).toBe(42);
      expect(projectSchemaToSpace('schema', member, [])).toBe('schema');
    });

    it('returns schemas without a `tables` field unchanged (identity-preserving)', () => {
      const schema = { other: 'shape' };
      const member = memberWithTables('app', {});
      const others = [memberWithTables('ext', { x: {} })];
      expect(projectSchemaToSpace(schema, member, others)).toBe(schema);
    });

    it('returns schemas whose `tables` is not a plain object unchanged', () => {
      const schema = { tables: 'not-an-object' };
      const member = memberWithTables('app', {});
      const others = [memberWithTables('ext', { x: {} })];
      expect(projectSchemaToSpace(schema, member, others)).toBe(schema);
    });

    it('skips other-space members whose contracts do not match the duck-typed shape', () => {
      const schema = { tables: { app_users: { columns: {} }, ext_table: { columns: {} } } };
      const member = memberWithTables('app', {});
      const others: ReadonlyArray<ContractSpaceMember> = [
        memberWithMalformedStorage('ext-1', null),
        memberWithMalformedStorage('ext-2', 'not-an-object'),
        memberWithMalformedStorage('ext-3', { tables: null }),
        memberWithMalformedStorage('ext-4', { tables: 'not-a-record' }),
      ];
      expect(projectSchemaToSpace(schema, member, others)).toBe(schema);
    });
  });

  describe('zero-cost path (no other-space contracts)', () => {
    it('returns the schema verbatim when other-members list is empty', () => {
      const schema = { tables: { user: {}, post: {} } };
      const member = memberWithTables('app', { user: {}, post: {} });
      expect(projectSchemaToSpace(schema, member, [])).toBe(schema);
    });

    it('returns the schema verbatim when other-members list contains only the projection target', () => {
      const schema = { tables: { user: {}, post: {} } };
      const member = memberWithTables('app', { user: {}, post: {} });
      expect(projectSchemaToSpace(schema, member, [member])).toBe(schema);
    });
  });

  describe('genuine projection', () => {
    it('removes only tables claimed by other-space members', () => {
      const schema = {
        tables: {
          app_user: { columns: { id: {} } },
          ext_audit_log: { columns: { id: {} } },
          ext_feature_flag: { columns: { id: {} } },
        },
      };
      const member = memberWithTables('app', { app_user: {} });
      const others = [
        memberWithTables('audit', { ext_audit_log: { columns: {} } }),
        memberWithTables('flags', { ext_feature_flag: { columns: {} } }),
      ];

      const projected = projectSchemaToSpace(schema, member, others) as {
        readonly tables: Record<string, unknown>;
      };

      expect(Object.keys(projected.tables).sort()).toEqual(['app_user']);
      expect(projected.tables['app_user']).toBe(schema.tables['app_user']);
    });

    it('preserves orphan tables (live tables owned by no member) so the planner can flag them as extras', () => {
      const orphanTable = { columns: { id: {} } };
      const schema = {
        tables: {
          app_user: { columns: { id: {} } },
          ext_owned: { columns: { id: {} } },
          orphan_table: orphanTable,
        },
      };
      const member = memberWithTables('app', { app_user: {} });
      const others = [memberWithTables('ext', { ext_owned: { columns: {} } })];

      const projected = projectSchemaToSpace(schema, member, others) as {
        readonly tables: Record<string, unknown>;
      };

      expect(Object.keys(projected.tables).sort()).toEqual(['app_user', 'orphan_table']);
      expect(projected.tables['orphan_table']).toBe(orphanTable);
    });

    it('preserves non-`tables` storage fields on the schema object', () => {
      const schema = {
        tables: { ext_owned: {}, app_user: {} },
        views: { v1: {} },
        meta: { dialect: 'postgres' },
      };
      const member = memberWithTables('app', { app_user: {} });
      const others = [memberWithTables('ext', { ext_owned: {} })];

      const projected = projectSchemaToSpace(schema, member, others) as {
        readonly tables: Record<string, unknown>;
        readonly views: Record<string, unknown>;
        readonly meta: { readonly dialect: string };
      };

      expect(Object.keys(projected.tables)).toEqual(['app_user']);
      expect(projected.views).toBe(schema.views);
      expect(projected.meta).toBe(schema.meta);
    });

    it('removes other-member collections from a Mongo-shaped introspected schema (array form)', () => {
      // Mongo's introspected `MongoSchemaIR` exposes
      // `collections: ReadonlyArray<{name, ...}>` rather than a record.
      // The projector duck-types the array shape on the schema side;
      // other-members supply record-shaped Mongo contract storage.
      const appColl = { name: 'users', indexes: [] };
      const extColl = { name: 'cipherstash_state', indexes: [] };
      const orphanColl = { name: 'legacy_audit', indexes: [] };
      const schema = { collections: [appColl, extColl, orphanColl] };

      const member = memberWithCollections('app', { users: {} });
      const others = [memberWithCollections('cipherstash', { cipherstash_state: {} })];

      const projected = projectSchemaToSpace(schema, member, others) as {
        readonly collections: ReadonlyArray<{ readonly name: string }>;
      };

      expect(projected.collections.map((c) => c.name).sort()).toEqual(['legacy_audit', 'users']);
      expect(projected.collections).not.toBe(schema.collections);
      expect(projected.collections.find((c) => c.name === 'users')).toBe(appColl);
      expect(projected.collections.find((c) => c.name === 'legacy_audit')).toBe(orphanColl);
    });

    it('returns the schema verbatim when no other-member collections are claimed', () => {
      const schema = { collections: [{ name: 'users' }] };
      const member = memberWithCollections('app', { users: {} });
      expect(projectSchemaToSpace(schema, member, [member])).toBe(schema);
    });

    it('preserves non-`collections` fields on a Mongo-shaped schema object', () => {
      const schema = {
        collections: [{ name: 'app_users' }, { name: 'ext_owned' }],
        meta: { driverVersion: '6.0' },
      };
      const member = memberWithCollections('app', { app_users: {} });
      const others = [memberWithCollections('ext', { ext_owned: {} })];

      const projected = projectSchemaToSpace(schema, member, others) as {
        readonly collections: ReadonlyArray<{ readonly name: string }>;
        readonly meta: { readonly driverVersion: string };
      };

      expect(projected.collections.map((c) => c.name)).toEqual(['app_users']);
      expect(projected.meta).toBe(schema.meta);
    });

    it('cross-shape: SQL-shaped schema with a Mongo-shaped other-member is returned unchanged', () => {
      // The SQL schema only exposes `.tables`; a Mongo other-member only
      // claims `.collections`. The projector must not strip SQL tables
      // because of a Mongo claim, and there are no Mongo collections in
      // the SQL schema to strip — net effect: identity.
      const schema = { tables: { users: {}, posts: {} } };
      const member = memberWithTables('app', { users: {}, posts: {} });
      const others = [memberWithCollections('mongo-ext', { audit_log: {} })];

      expect(projectSchemaToSpace(schema, member, others)).toBe(schema);
    });

    it('does not include the projection target itself when it appears in `otherMembers` (defensive)', () => {
      const schema = {
        tables: {
          app_user: { columns: {} },
          ext_owned: { columns: {} },
        },
      };
      const member = memberWithTables('app', { app_user: {} });
      const others = [member, memberWithTables('ext', { ext_owned: {} })];

      const projected = projectSchemaToSpace(schema, member, others) as {
        readonly tables: Record<string, unknown>;
      };

      // app_user is not stripped even though `member` claims it: the
      // function filters by spaceId equality.
      expect(Object.keys(projected.tables).sort()).toEqual(['app_user']);
    });
  });
});
