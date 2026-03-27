import { BinaryExpr, ColumnRef, ParamRef } from '@prisma-next/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { Collection } from '../src/collection';
import type { TestContract } from './helpers';
import { createMockRuntime, getTestContract } from './helpers';

class PostCollection extends Collection<TestContract, 'Post'> {
  popular() {
    return this.where((p) => p.views.gt(1000));
  }
}

describe('Collection construction', () => {
  const contract = getTestContract();

  it('resolves table name from contract mappings', () => {
    const runtime = createMockRuntime();
    const collection = new Collection({ contract, runtime }, 'User');
    expect(collection.tableName).toBe('users');
  });

  it('initializes with empty state', () => {
    const runtime = createMockRuntime();
    const collection = new Collection({ contract, runtime }, 'Post');
    expect(collection.state.filters).toEqual([]);
    expect(collection.state.includes).toEqual([]);
    expect(collection.state.orderBy).toBeUndefined();
    expect(collection.state.limit).toBeUndefined();
    expect(collection.state.offset).toBeUndefined();
  });

  it('supports custom subclass with named scopes', () => {
    const runtime = createMockRuntime();
    const collection = new PostCollection({ contract, runtime }, 'Post');
    const scoped = collection.popular();
    expect(scoped.state.filters).toHaveLength(1);
    expect(scoped.state.filters[0]).toEqual(
      BinaryExpr.gt(
        ColumnRef.of('posts', 'views'),
        ParamRef.of(1000, {
          name: 'views',
          codecId: 'pg/int4@1',
        }),
      ),
    );
  });
});
