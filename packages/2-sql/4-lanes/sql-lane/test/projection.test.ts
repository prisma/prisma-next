import { ColumnRef } from '@prisma-next/sql-relational-core/ast';
import { schema } from '@prisma-next/sql-relational-core/schema';
import type { AnyColumnBuilder } from '@prisma-next/sql-relational-core/types';
import { describe, expect, it } from 'vitest';
import {
  AliasTracker,
  buildProjectionState,
  flattenProjection,
  generateAlias,
} from '../src/sql/projection';
import type { Contract } from './fixtures/contract.d';
import { createFixtureContext, loadFixtureContract } from './test-helpers';

describe('projection', () => {
  const contract = loadFixtureContract<Contract>('contract');
  const context = createFixtureContext(contract);
  const tables = schema<Contract>(context).tables;
  const userColumns = tables.user.columns;

  it('generates aliases and tracks collisions', () => {
    const tracker = new AliasTracker();

    expect(generateAlias(['user', 'id'])).toBe('user_id');
    expect(tracker.register(['user', 'id'])).toBe('user_id');
    expect(tracker.getPath('user_id')).toEqual(['user', 'id']);
    expect(() => tracker.register(['user', 'id'])).toThrow('Alias collision');
  });

  it('flattens simple and nested projections', () => {
    expect(
      flattenProjection(
        {
          id: userColumns.id,
          user: {
            email: userColumns.email,
          },
        },
        new AliasTracker(),
      ),
    ).toEqual({
      aliases: ['id', 'user_email'],
      columns: [userColumns.id, userColumns.email],
    });
  });

  it('builds projection state including include placeholders', () => {
    const result = buildProjectionState(
      { name: 'user' },
      {
        id: userColumns.id,
        posts: true,
      },
      [
        {
          alias: 'posts',
          table: { name: 'post' },
          on: {
            kind: 'join-on',
            left: userColumns.id,
            right: userColumns.id,
          },
          childProjection: {
            aliases: ['id'],
            columns: [userColumns.id],
          },
        },
      ],
    );

    expect(result.aliases).toEqual(['id', 'posts']);
    expect(result.columns[1]?.toExpr()).toEqual(ColumnRef.of('post', ''));
  });

  it('rejects invalid or empty projections', () => {
    expect(() => buildProjectionState({ name: 'user' }, {})).toThrow(
      'select() requires at least one column or include',
    );
    expect(() =>
      flattenProjection(
        {
          invalid: null as unknown as AnyColumnBuilder,
        },
        new AliasTracker(),
      ),
    ).toThrow('Invalid projection value');
  });
});
