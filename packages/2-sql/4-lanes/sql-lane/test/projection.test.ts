import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateContract } from '@prisma-next/sql-contract/validate';
import { createTableRef } from '@prisma-next/sql-relational-core/ast';
import { schema } from '@prisma-next/sql-relational-core/schema';
import type { AnyColumnBuilder } from '@prisma-next/sql-relational-core/types';
import { createStubAdapter, createTestContext } from '@prisma-next/sql-runtime/test/utils';
import { describe, expect, it } from 'vitest';
import {
  AliasTracker,
  buildProjectionState,
  flattenProjection,
  generateAlias,
} from '../src/sql/projection';
import type { Contract } from './fixtures/contract.d';

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

function loadContract(name: string): Contract {
  const filePath = join(fixtureDir, `${name}.json`);
  const contents = readFileSync(filePath, 'utf8');
  const contractJson = JSON.parse(contents);
  return validateContract<Contract>(contractJson);
}

describe('projection', () => {
  describe('generateAlias', () => {
    it('generates alias from path', () => {
      expect(generateAlias(['user', 'id'])).toBe('user_id');
      expect(generateAlias(['user', 'profile', 'name'])).toBe('user_profile_name');
    });

    it('throws when path is empty', () => {
      expect(() => generateAlias([])).toThrow('Alias path cannot be empty');
    });
  });

  describe('AliasTracker', () => {
    it('registers aliases', () => {
      const tracker = new AliasTracker();
      const alias1 = tracker.register(['user', 'id']);
      const alias2 = tracker.register(['user', 'name']);

      expect(alias1).toBe('user_id');
      expect(alias2).toBe('user_name');
      expect(tracker.has('user_id')).toBe(true);
      expect(tracker.has('user_name')).toBe(true);
    });

    it('throws on alias collision', () => {
      const tracker = new AliasTracker();
      tracker.register(['user', 'id']);

      expect(() => tracker.register(['user', 'id'])).toThrow('Alias collision');
    });

    it('retrieves path for alias', () => {
      const tracker = new AliasTracker();
      const alias = tracker.register(['user', 'id']);
      const path = tracker.getPath(alias);

      expect(path).toEqual(['user', 'id']);
    });

    it('returns undefined for unknown alias', () => {
      const tracker = new AliasTracker();
      const path = tracker.getPath('unknown');

      expect(path).toBeUndefined();
    });
  });

  describe('flattenProjection', () => {
    const contract = loadContract('contract');
    const adapter = createStubAdapter();
    const context = createTestContext(contract, adapter);
    const tables = schema<Contract>(context).tables;
    const userColumns = tables.user.columns;

    it('flattens simple projection', () => {
      const tracker = new AliasTracker();
      const result = flattenProjection(
        {
          id: userColumns.id,
          email: userColumns.email,
        },
        tracker,
      );

      expect(result.aliases).toEqual(['id', 'email']);
      expect(result.columns).toHaveLength(2);
    });

    it('flattens nested projection', () => {
      const tracker = new AliasTracker();
      const result = flattenProjection(
        {
          user: {
            id: userColumns.id,
            email: userColumns.email,
          },
        },
        tracker,
      );

      expect(result.aliases).toEqual(['user_id', 'user_email']);
      expect(result.columns).toHaveLength(2);
    });

    it('throws on invalid projection value', () => {
      const tracker = new AliasTracker();
      expect(() =>
        flattenProjection(
          {
            id: userColumns.id,
            invalid: null as unknown as AnyColumnBuilder,
          },
          tracker,
        ),
      ).toThrow('Invalid projection value');
    });
  });

  describe('buildProjectionState', () => {
    const contract = loadContract('contract');
    const adapter = createStubAdapter();
    const context = createTestContext(contract, adapter);
    const tables = schema<Contract>(context).tables;
    const userTable = tables.user;
    const userColumns = userTable.columns;
    const tableRef = createTableRef('user');

    it('builds projection state from simple projection', () => {
      const result = buildProjectionState(tableRef, {
        id: userColumns.id,
        email: userColumns.email,
      });

      expect(result.aliases).toEqual(['id', 'email']);
      expect(result.columns).toHaveLength(2);
    });

    it('builds projection state from nested projection', () => {
      const result = buildProjectionState(tableRef, {
        user: {
          id: userColumns.id,
          email: userColumns.email,
        },
      });

      expect(result.aliases).toEqual(['user_id', 'user_email']);
      expect(result.columns).toHaveLength(2);
    });

    it('handles include references with boolean true', () => {
      const includes = [
        {
          alias: 'posts',
          table: createTableRef('post'),
          on: {
            kind: 'join-on' as const,
            left: userColumns.id,
            right: userColumns.id,
          },
          childProjection: {
            aliases: ['id'],
            columns: [userColumns.id],
          },
        },
      ];

      const result = buildProjectionState(
        tableRef,
        {
          id: userColumns.id,
          posts: true,
        },
        includes,
      );

      expect(result.aliases).toContain('posts');
      expect(result.aliases).toContain('id');
    });

    it('throws when include alias not found', () => {
      expect(() =>
        buildProjectionState(
          tableRef,
          {
            id: userColumns.id,
            posts: true,
          },
          [],
        ),
      ).toThrow('Include alias "posts" not found');
    });

    it('throws when projection is empty', () => {
      expect(() => buildProjectionState(tableRef, {})).toThrow(
        'select() requires at least one column or include',
      );
    });

    it('throws on invalid projection key', () => {
      expect(() =>
        buildProjectionState(tableRef, {
          id: userColumns.id,
          invalid: 'invalid' as unknown as AnyColumnBuilder,
        }),
      ).toThrow('Invalid projection value at key "invalid"');
    });
  });
});
