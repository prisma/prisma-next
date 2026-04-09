import {
  BinaryExpr,
  ColumnRef,
  type InsertAst,
  LiteralExpr,
} from '@prisma-next/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { Collection } from '../src/collection';
import { withReturningCapability } from './collection-fixtures';
import {
  buildMixedPolyContract,
  buildStiPolyContract,
  createMockRuntime,
  getTestContext,
} from './helpers';

function createPolyCollection() {
  const contract = buildStiPolyContract();
  const baseContext = getTestContext();
  const context = { ...baseContext, contract };
  const runtime = createMockRuntime();
  const collection = new Collection({ runtime, context }, 'User');
  return { collection, runtime, contract };
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

describe('STI polymorphic query pipeline', () => {
  it('base query maps mixed-variant rows into variant-specific shapes', async () => {
    const { collection, runtime } = createPolyCollection();
    runtime.setNextResults([
      [
        { id: 1, name: 'Alice', email: 'a@x', kind: 'admin', role: 'superadmin', plan: null },
        { id: 2, name: 'Bob', email: 'b@x', kind: 'regular', role: null, plan: 'free' },
      ],
    ]);

    const rows = await collection.all().toArray();

    expect(rows).toHaveLength(2);
    const admin = rows[0]!;
    expect(admin).toEqual({
      id: 1,
      name: 'Alice',
      email: 'a@x',
      kind: 'admin',
      role: 'superadmin',
    });
    expect(admin).not.toHaveProperty('plan');

    const regular = rows[1]!;
    expect(regular).toEqual({
      id: 2,
      name: 'Bob',
      email: 'b@x',
      kind: 'regular',
      plan: 'free',
    });
    expect(regular).not.toHaveProperty('role');
  });

  it('variant query maps all rows with the specified variant shape', async () => {
    const { collection, runtime } = createPolyCollection();
    runtime.setNextResults([
      [{ id: 1, name: 'Alice', email: 'a@x', kind: 'admin', role: 'superadmin', plan: null }],
    ]);

    const rows = await (collection.variant('Admin' as never) as typeof collection).all().toArray();

    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      id: 1,
      name: 'Alice',
      email: 'a@x',
      kind: 'admin',
      role: 'superadmin',
    });
    expect(rows[0]).not.toHaveProperty('plan');
  });
});

function createMixedPolyCollection() {
  const contract = buildMixedPolyContract();
  const baseContext = getTestContext();
  const context = { ...baseContext, contract };
  const runtime = createMockRuntime();
  const collection = new Collection({ runtime, context }, 'Task');
  return { collection, runtime };
}

describe('Mixed STI+MTI polymorphic query pipeline', () => {
  it('base query maps Bug (STI) and Feature (MTI) rows to variant-specific shapes', async () => {
    const { collection, runtime } = createMixedPolyCollection();
    runtime.setNextResults([
      [
        { id: 1, title: 'Crash', type: 'bug', severity: 'critical', features__priority: null },
        { id: 2, title: 'Dark mode', type: 'feature', severity: null, features__priority: 1 },
      ],
    ]);

    const rows = await collection.all().toArray();

    expect(rows).toHaveLength(2);

    const bug = rows[0]!;
    expect(bug).toEqual({ id: 1, title: 'Crash', type: 'bug', severity: 'critical' });
    expect(bug).not.toHaveProperty('priority');

    const feature = rows[1]!;
    expect(feature).toEqual({ id: 2, title: 'Dark mode', type: 'feature', priority: 1 });
    expect(feature).not.toHaveProperty('severity');
  });

  it('variant(Bug) query maps Bug STI rows only', async () => {
    const { collection, runtime } = createMixedPolyCollection();
    runtime.setNextResults([[{ id: 1, title: 'Crash', type: 'bug', severity: 'critical' }]]);

    const rows = await (collection.variant('Bug' as never) as typeof collection).all().toArray();

    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ id: 1, title: 'Crash', type: 'bug', severity: 'critical' });
  });

  it('variant(Feature) query maps Feature MTI rows only', async () => {
    const { collection, runtime } = createMixedPolyCollection();
    runtime.setNextResults([
      [{ id: 2, title: 'Dark mode', type: 'feature', features__priority: 1 }],
    ]);

    const rows = await (collection.variant('Feature' as never) as typeof collection)
      .all()
      .toArray();

    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ id: 2, title: 'Dark mode', type: 'feature', priority: 1 });
  });
});

function createReturningMixedPolyCollection() {
  const contract = withReturningCapability(buildMixedPolyContract());
  const baseContext = getTestContext();
  const context = { ...baseContext, contract };
  const runtime = createMockRuntime();
  const collection = new Collection({ runtime, context }, 'Task');
  return { collection, runtime, contract };
}

describe('STI variant create (discriminator auto-injection)', () => {
  it('injects discriminator column/value into INSERT for STI variant', async () => {
    const { collection, runtime } = createReturningMixedPolyCollection();
    runtime.setNextResults([[{ id: 1, title: 'Crash', type: 'bug', severity: 'critical' }]]);

    const narrowed = collection.variant('Bug' as never) as typeof collection;
    await narrowed.createAll([{ title: 'Crash', severity: 'critical' } as never]).toArray();

    const execution = runtime.executions[0]!;
    const ast = execution.plan.ast as InsertAst;
    expect(ast.kind).toBe('insert');

    const firstRow = ast.rows![0]!;
    const typeParam = firstRow['type'];
    expect(typeParam).toBeDefined();
    expect(typeParam!.kind).toBe('param-ref');
    expect((typeParam as { value: unknown }).value).toBe('bug');
  });

  it('maps variant fields through merged base+variant column map', async () => {
    const { collection, runtime } = createReturningMixedPolyCollection();
    runtime.setNextResults([[{ id: 1, title: 'Crash', type: 'bug', severity: 'critical' }]]);

    const narrowed = collection.variant('Bug' as never) as typeof collection;
    await narrowed.createAll([{ title: 'Crash', severity: 'critical' } as never]).toArray();

    const execution = runtime.executions[0]!;
    const ast = execution.plan.ast as InsertAst;
    const firstRow = ast.rows![0]!;

    expect(firstRow['title']).toBeDefined();
    expect(firstRow['severity']).toBeDefined();
    expect(firstRow['type']).toBeDefined();
  });
});

describe('MTI variant mutation guards', () => {
  it('createCount() throws for MTI variants', async () => {
    const { collection } = createReturningMixedPolyCollection();
    const narrowed = collection.variant('Feature' as never) as typeof collection;
    await expect(narrowed.createCount([{ title: 'X', priority: 1 } as never])).rejects.toThrow(
      /createCount\(\) is not supported for MTI variant/,
    );
  });

  it('upsert() throws for MTI variants', async () => {
    const { collection } = createReturningMixedPolyCollection();
    const narrowed = collection.variant('Feature' as never) as typeof collection;
    await expect(
      narrowed.upsert({
        create: { title: 'X', priority: 1 } as never,
        update: {},
      }),
    ).rejects.toThrow(/upsert\(\) is not supported for MTI variant/);
  });
});

describe('MTI variant create (two-INSERT orchestration)', () => {
  it('executes two INSERTs: base table then variant table', async () => {
    const { collection, runtime } = createReturningMixedPolyCollection();
    runtime.setNextResults([
      [{ id: 10, title: 'Dark mode', type: 'feature' }],
      [{ id: 10, priority: 1 }],
    ]);

    const narrowed = collection.variant('Feature' as never) as typeof collection;
    await narrowed.createAll([{ title: 'Dark mode', priority: 1 } as never]).toArray();

    expect(runtime.executions).toHaveLength(2);

    const baseAst = runtime.executions[0]!.plan.ast as InsertAst;
    expect(baseAst.kind).toBe('insert');
    expect(baseAst.table.name).toBe('tasks');

    const baseRow = baseAst.rows![0]!;
    expect(baseRow['title']).toBeDefined();
    expect(baseRow['type']).toBeDefined();
    expect((baseRow['type'] as { value: unknown }).value).toBe('feature');
    expect(baseRow['priority']).toBeUndefined();

    const variantAst = runtime.executions[1]!.plan.ast as InsertAst;
    expect(variantAst.kind).toBe('insert');
    expect(variantAst.table.name).toBe('features');

    const variantRow = variantAst.rows![0]!;
    expect(variantRow['priority']).toBeDefined();
    expect(variantRow['id']).toBeDefined();
    expect((variantRow['id'] as { value: unknown }).value).toBe(10);
  });
});
