import { BinaryExpr, ColumnRef, LiteralExpr } from '@prisma-next/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { Collection } from '../src/collection';
import type { TestContract } from './helpers';
import { createMockRuntime, getTestContext, getTestContract } from './helpers';

function getPolyContract(): TestContract {
  const base = getTestContract();
  const raw = JSON.parse(JSON.stringify(base));
  raw.models.User.fields.kind = {
    nullable: false,
    type: { kind: 'scalar', codecId: 'pg/text@1' },
  };
  raw.models.User.storage.fields.kind = { column: 'kind' };
  raw.models.User.discriminator = { field: 'kind' };
  raw.models.User.variants = {
    Admin: { value: 'admin' },
    Regular: { value: 'regular' },
  };
  raw.storage.tables.users.columns.kind = {
    codecId: 'pg/text@1',
    nativeType: 'text',
    nullable: false,
  };
  return raw as TestContract;
}

function createPolyCollection() {
  const contract = getPolyContract();
  const baseContext = getTestContext();
  const context = { ...baseContext, contract };
  const runtime = createMockRuntime();
  const collection = new Collection({ runtime, context }, 'User');
  return { collection, runtime };
}

describe('Collection.variant()', () => {
  it('adds a discriminator filter to state', () => {
    const { collection } = createPolyCollection();
    const narrowed = collection.variant('Admin' as never);
    expect(narrowed.state.filters).toHaveLength(1);
    const filter = narrowed.state.filters[0];
    expect(filter).toBeInstanceOf(BinaryExpr);
    const binExpr = filter as BinaryExpr;
    expect(binExpr.left).toBeInstanceOf(ColumnRef);
    expect((binExpr.left as ColumnRef).column).toBe('kind');
    expect(binExpr.right).toBeInstanceOf(LiteralExpr);
    expect((binExpr.right as LiteralExpr).value).toBe('admin');
  });

  it('sets variantName on state', () => {
    const { collection } = createPolyCollection();
    const narrowed = collection.variant('Regular' as never);
    expect(narrowed.state.variantName).toBe('Regular');
  });

  it('replaces previous variant filter when chaining', () => {
    const { collection } = createPolyCollection();
    const first = collection.variant('Admin' as never);
    const second = first.variant('Regular' as never);

    expect(second.state.filters).toHaveLength(1);
    const filter = second.state.filters[0] as BinaryExpr;
    expect((filter.right as LiteralExpr).value).toBe('regular');
    expect(second.state.variantName).toBe('Regular');
  });

  it('returns unchanged collection when model has no discriminator', () => {
    const baseContext = getTestContext();
    const runtime = createMockRuntime();
    const collection = new Collection({ runtime, context: baseContext }, 'User');
    const result = collection.variant('Admin' as never);
    expect(result.state.filters).toHaveLength(0);
  });

  it('returns unchanged collection for unknown variant name', () => {
    const { collection } = createPolyCollection();
    const result = collection.variant('NonExistent' as never);
    expect(result.state.filters).toHaveLength(0);
  });

  it('preserves non-variant filters when chaining variants', () => {
    const { collection } = createPolyCollection();
    const withWhere = collection.where({ name: 'Alice' } as never);
    const narrowed = withWhere.variant('Admin' as never);

    expect(narrowed.state.filters).toHaveLength(2);
    const variantFilter = narrowed.state.filters[1] as BinaryExpr;
    expect((variantFilter.left as ColumnRef).column).toBe('kind');
  });

  it('preserves non-variant filters when re-narrowing', () => {
    const { collection } = createPolyCollection();
    const withWhere = collection.where({ name: 'Alice' } as never);
    const first = withWhere.variant('Admin' as never);
    const second = first.variant('Regular' as never);

    expect(second.state.filters).toHaveLength(2);
    const variantFilter = second.state.filters[1] as BinaryExpr;
    expect((variantFilter.right as LiteralExpr).value).toBe('regular');
  });
});
