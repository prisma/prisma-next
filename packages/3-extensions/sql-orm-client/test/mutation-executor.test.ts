import {
  type AnyExpression,
  BinaryExpr,
  ColumnRef,
  LiteralExpr,
} from '@prisma-next/sql-relational-core/ast';
import { describe, expect, it, vi } from 'vitest';
import {
  buildPrimaryKeyFilterFromRow,
  executeNestedCreateMutation,
  executeNestedUpdateMutation,
  hasNestedMutationCallbacks,
} from '../src/mutation-executor';
import type { MockRuntime, TestContract } from './helpers';
import {
  buildManyToManyContract,
  createMockRuntime,
  getTestContext,
  getTestContract,
  withPatchedDomainModels,
} from './helpers';

function withTransaction(runtime: MockRuntime) {
  const commit = vi.fn(async () => undefined);
  const rollback = vi.fn(async () => undefined);
  const transaction = {
    execute: runtime.execute.bind(runtime),
    commit,
    rollback,
  };

  const runtimeWithTransaction = Object.assign(runtime, {
    async transaction() {
      return transaction;
    },
  });

  return {
    runtime: runtimeWithTransaction,
    commit,
    rollback,
  };
}

function withConnection(runtime: MockRuntime, onRelease: () => void) {
  return Object.assign(runtime, {
    async connection() {
      return {
        execute: runtime.execute.bind(runtime),
        async release() {
          onRelease();
        },
      };
    },
  });
}

const postIdFilter: AnyExpression = BinaryExpr.eq(ColumnRef.of('posts', 'id'), LiteralExpr.of(1));

const userIdFilter: AnyExpression = BinaryExpr.eq(ColumnRef.of('users', 'id'), LiteralExpr.of(1));

describe('mutation-executor', () => {
  it('hasNestedMutationCallbacks() detects callbacks only on relation fields', () => {
    const contract = getTestContract();

    expect(
      hasNestedMutationCallbacks(contract, 'public', 'User', {
        posts: (posts: { connect: (criterion: Record<string, unknown>) => unknown }) =>
          posts.connect({ id: 1 }),
      }),
    ).toBe(true);

    expect(
      hasNestedMutationCallbacks(contract, 'public', 'User', {
        posts: { kind: 'connect', criteria: [{ id: 1 }] },
      }),
    ).toBe(false);

    expect(
      hasNestedMutationCallbacks(contract, 'public', 'User', {
        name: () => ({ kind: 'connect' }),
      }),
    ).toBe(false);
  });

  it('hasNestedMutationCallbacks() tolerates malformed relation metadata and unknown models', () => {
    const contract = getTestContract();
    const malformed = withPatchedDomainModels(contract, (models) => {
      const user = models['User'] as {
        relations: Record<string, unknown>;
      };
      return {
        ...models,
        User: {
          ...user,
          relations: {
            ...user.relations,
            notObject: 1,
            missingTo: {
              cardinality: '1:N',
              on: {
                parentCols: ['id'],
                childCols: ['user_id'],
              },
            },
            badCols: {
              to: { model: 'Post', namespace: '__unbound__' },
              cardinality: '1:N',
              on: {
                parentCols: 'id',
                childCols: ['user_id'],
              },
            },
            posts: {
              to: { model: 'Post', namespace: '__unbound__' },
              cardinality: 'INVALID',
              on: {
                localFields: ['id'],
                targetFields: ['userId'],
              },
            },
          },
        },
      };
    });

    expect(
      hasNestedMutationCallbacks(malformed, 'public', 'User', {
        posts: (posts: { connect: (criterion: Record<string, unknown>) => unknown }) =>
          posts.connect({ id: 1 }),
      }),
    ).toBe(true);

    expect(
      hasNestedMutationCallbacks(contract, 'public', 'UnknownModel', {
        anything: () => ({ kind: 'connect' }),
      }),
    ).toBe(false);
  });

  it('buildPrimaryKeyFilterFromRow() resolves mapped keys and throws when missing', () => {
    const contract = getTestContract();

    expect(buildPrimaryKeyFilterFromRow(contract, 'public', 'User', { id: 7 })).toEqual({ id: 7 });

    expect(() => buildPrimaryKeyFilterFromRow(contract, 'public', 'User', {})).toThrow(
      /Missing primary key field "id"/,
    );
  });

  it('buildPrimaryKeyFilterFromRow() resolves custom primary key columns', () => {
    const contract = getTestContract();

    // Tables live in 'public' after public-by-default; put the custom-pk
    // override in the same namespace so the scan-all-namespaces lookup finds it.
    const publicNs = contract.storage.namespaces['public']!;
    const withCustomPk = {
      ...contract,
      storage: {
        ...contract.storage,
        namespaces: {
          ...contract.storage.namespaces,
          public: {
            ...publicNs,
            entries: {
              ...publicNs.entries,
              table: {
                ...(publicNs.entries.table ?? {}),
                users: {
                  ...publicNs.entries.table?.['users'],
                  primaryKey: { columns: ['pk_id'] },
                },
              },
            },
          },
        },
      },
    } as unknown as TestContract;

    expect(buildPrimaryKeyFilterFromRow(withCustomPk, 'public', 'User', { pk_id: 99 })).toEqual({
      pk_id: 99,
    });
  });

  it('executeNestedCreateMutation() commits transactions on success', async () => {
    const contract = getTestContract();
    const runtime = createMockRuntime();
    runtime.setNextResults([[{ id: 1, name: 'Alice', email: 'alice@example.com' }]]);
    const transactional = withTransaction(runtime);

    const created = await executeNestedCreateMutation({
      context: { ...getTestContext(), contract },
      runtime: transactional.runtime,
      namespaceId: 'public',
      modelName: 'User',
      data: { id: 1, name: 'Alice', email: 'alice@example.com' } as never,
    });

    expect(created).toEqual({ id: 1, name: 'Alice', email: 'alice@example.com' });
    expect(transactional.commit).toHaveBeenCalledTimes(1);
    expect(transactional.rollback).not.toHaveBeenCalled();
  });

  it('executeNestedCreateMutation() supports transaction scopes without commit/rollback hooks', async () => {
    const contract = getTestContract();
    const runtime = createMockRuntime();
    runtime.setNextResults([[{ id: 1, name: 'Alice', email: 'alice@example.com' }]]);

    const runtimeWithBareTransaction = Object.assign(runtime, {
      async transaction() {
        return {
          execute: runtime.execute.bind(runtime),
        };
      },
    });

    const created = await executeNestedCreateMutation({
      context: { ...getTestContext(), contract },
      runtime: runtimeWithBareTransaction,
      namespaceId: 'public',
      modelName: 'User',
      data: { id: 1, name: 'Alice', email: 'alice@example.com' } as never,
    });

    expect(created).toEqual({ id: 1, name: 'Alice', email: 'alice@example.com' });
  });

  it('executeNestedCreateMutation() rolls back transactions on failures', async () => {
    const contract = getTestContract();
    const runtime = createMockRuntime();
    runtime.setNextResults([[]]);
    const transactional = withTransaction(runtime);

    await expect(
      executeNestedCreateMutation({
        context: { ...getTestContext(), contract },
        runtime: transactional.runtime,
        namespaceId: 'public',
        modelName: 'User',
        data: { id: 1, name: 'Alice', email: 'alice@example.com' } as never,
      }),
    ).rejects.toThrow(/did not return a row/);

    expect(transactional.commit).not.toHaveBeenCalled();
    expect(transactional.rollback).toHaveBeenCalledTimes(1);
  });

  it('executeNestedCreateMutation() releases scoped connections when no transaction is available', async () => {
    const contract = getTestContract();
    const runtime = createMockRuntime();
    runtime.setNextResults([[{ id: 1, name: 'Alice', email: 'alice@example.com' }]]);

    let released = false;
    const scopedRuntime = withConnection(runtime, () => {
      released = true;
    });

    await executeNestedCreateMutation({
      context: { ...getTestContext(), contract },
      runtime: scopedRuntime,
      namespaceId: 'public',
      modelName: 'User',
      data: { id: 1, name: 'Alice', email: 'alice@example.com' } as never,
    });

    expect(released).toBe(true);
  });

  it('executeNestedCreateMutation() validates relation mutator input shapes', async () => {
    const contract = getTestContract();
    const runtime = createMockRuntime();

    await expect(
      executeNestedCreateMutation({
        context: { ...getTestContext(), contract },
        runtime,
        namespaceId: 'public',
        modelName: 'User',
        data: {
          id: 1,
          name: 'Alice',
          email: 'alice@example.com',
          posts: { kind: 'connect' },
        } as never,
      }),
    ).rejects.toThrow(/expects a mutator callback/);

    await expect(
      executeNestedCreateMutation({
        context: { ...getTestContext(), contract },
        runtime,
        namespaceId: 'public',
        modelName: 'User',
        data: {
          id: 1,
          name: 'Alice',
          email: 'alice@example.com',
          posts: () => ({ invalid: true }),
        } as never,
      }),
    ).rejects.toThrow(/invalid mutation descriptor/);
  });

  it('executeNestedCreateMutation() rejects unsupported disconnect() in create graphs', async () => {
    const contract = getTestContract();
    const runtime = createMockRuntime();

    await expect(
      executeNestedCreateMutation({
        context: { ...getTestContext(), contract },
        runtime,
        namespaceId: 'public',
        modelName: 'Post',
        data: {
          id: 1,
          title: 'Post',
          views: 1,
          author: (author: { disconnect: () => unknown }) => author.disconnect(),
        } as never,
      }),
    ).rejects.toThrow(/disconnect\(\) is only supported in update\(\) nested mutations/);

    runtime.setNextResults([[{ id: 1, name: 'Alice', email: 'alice@example.com' }]]);
    await expect(
      executeNestedCreateMutation({
        context: { ...getTestContext(), contract },
        runtime,
        namespaceId: 'public',
        modelName: 'User',
        data: {
          id: 1,
          name: 'Alice',
          email: 'alice@example.com',
          posts: (posts: { disconnect: () => unknown }) => posts.disconnect(),
        } as never,
      }),
    ).rejects.toThrow(/disconnect\(\) is only supported in update\(\) nested mutations/);
  });

  it('executeNestedCreateMutation() validates connect/create payloads for parent-owned relations', async () => {
    const contract = getTestContract();
    const runtime = createMockRuntime();

    await expect(
      executeNestedCreateMutation({
        context: { ...getTestContext(), contract },
        runtime,
        namespaceId: 'public',
        modelName: 'Post',
        data: {
          id: 1,
          title: 'Post',
          views: 1,
          author: (author: {
            connect: (criteria: readonly Record<string, unknown>[]) => unknown;
          }) => author.connect([]),
        } as never,
      }),
    ).rejects.toThrow(/requires criterion/);

    await expect(
      executeNestedCreateMutation({
        context: { ...getTestContext(), contract },
        runtime,
        namespaceId: 'public',
        modelName: 'Post',
        data: {
          id: 1,
          title: 'Post',
          views: 1,
          author: (author: { connect: (criterion: Record<string, unknown>) => unknown }) =>
            author.connect({}),
        } as never,
      }),
    ).rejects.toThrow(/requires non-empty criterion/);

    runtime.setNextResults([[]]);
    await expect(
      executeNestedCreateMutation({
        context: { ...getTestContext(), contract },
        runtime,
        namespaceId: 'public',
        modelName: 'Post',
        data: {
          id: 1,
          title: 'Post',
          views: 1,
          author: (author: { connect: (criterion: Record<string, unknown>) => unknown }) =>
            author.connect({ id: 5 }),
        } as never,
      }),
    ).rejects.toThrow(/did not find a matching row/);

    await expect(
      executeNestedCreateMutation({
        context: { ...getTestContext(), contract },
        runtime,
        namespaceId: 'public',
        modelName: 'Post',
        data: {
          id: 1,
          title: 'Post',
          views: 1,
          author: (author: { create: (data: readonly Record<string, unknown>[]) => unknown }) =>
            author.create([]),
        } as never,
      }),
    ).rejects.toThrow(/requires data/);
  });

  function findJunctionDml(
    runtime: MockRuntime,
    kind: 'insert' | 'delete',
    table: string,
  ): { kind: string; table: { name: string }; rows?: unknown; where?: unknown } {
    for (const execution of runtime.executions) {
      const ast = (execution.plan as { ast?: { kind: string; table?: { name: string } } }).ast;
      if (ast && ast.kind === kind && ast.table?.name === table) {
        return ast as { kind: string; table: { name: string }; rows?: unknown; where?: unknown };
      }
    }
    throw new Error(`no ${kind} on "${table}" found in executions`);
  }

  function collectLiterals(node: unknown): unknown[] {
    if (!node || typeof node !== 'object') {
      return [];
    }
    const expr = node as {
      kind?: string;
      value?: unknown;
      left?: unknown;
      right?: unknown;
      exprs?: readonly unknown[];
    };
    if (expr.kind === 'literal') {
      return [expr.value];
    }
    return [
      ...collectLiterals(expr.left),
      ...collectLiterals(expr.right),
      ...(expr.exprs ?? []).flatMap(collectLiterals),
    ];
  }

  it('executeNestedCreateMutation() routes M:N connect through a junction INSERT', async () => {
    const contract = buildManyToManyContract({
      junctionTable: 'parent_child',
      parentColumns: ['parent_id'],
      childColumns: ['child_id'],
      targetColumns: ['id'],
    });
    const runtime = createMockRuntime();
    runtime.setNextResults([[{ id: 1 }], [{ id: 10 }], []]);

    const created = await executeNestedCreateMutation({
      context: { ...getTestContext(), contract },
      runtime,
      modelName: 'Parent',
      data: {
        id: 1,
        children: (children: { connect: (criterion: Record<string, unknown>) => unknown }) =>
          children.connect({ id: 10 }),
      } as never,
    });

    expect(created).toEqual({ id: 1 });
    const insert = findJunctionDml(runtime, 'insert', 'parent_child');
    const junctionRow = (insert.rows as ReadonlyArray<Record<string, unknown>>)[0]!;
    expect(Object.keys(junctionRow).sort()).toEqual(['child_id', 'parent_id']);
    expect((runtime.executions.at(-1)!.plan as { params: readonly unknown[] }).params).toEqual([
      1, 10,
    ]);
  });

  it('executeNestedCreateMutation() routes M:N create through target INSERT then junction INSERT', async () => {
    const contract = buildManyToManyContract({
      junctionTable: 'parent_child',
      parentColumns: ['parent_id'],
      childColumns: ['child_id'],
      targetColumns: ['id'],
    });
    const runtime = createMockRuntime();
    runtime.setNextResults([[{ id: 1 }], [{ id: 20 }], []]);

    const created = await executeNestedCreateMutation({
      context: { ...getTestContext(), contract },
      runtime,
      modelName: 'Parent',
      data: {
        id: 1,
        children: (children: { create: (rows: readonly Record<string, unknown>[]) => unknown }) =>
          children.create([{ id: 20 }]),
      } as never,
    });

    expect(created).toEqual({ id: 1 });
    const targetInsert = findJunctionDml(runtime, 'insert', 'children');
    expect(targetInsert.kind).toBe('insert');
    const link = (
      findJunctionDml(runtime, 'insert', 'parent_child').rows as ReadonlyArray<
        Record<string, unknown>
      >
    )[0]!;
    expect(Object.keys(link).sort()).toEqual(['child_id', 'parent_id']);
    expect((runtime.executions.at(-1)!.plan as { params: readonly unknown[] }).params).toEqual([
      1, 20,
    ]);
  });

  it('executeNestedCreateMutation() AND-s composite keys in the junction INSERT', async () => {
    const contract = buildManyToManyContract({
      junctionTable: 'parent_child',
      parentColumns: ['tenant_id', 'parent_id'],
      childColumns: ['tenant_id', 'child_id'],
      targetColumns: ['tenant_id', 'id'],
      localFields: ['tenant_id', 'id'],
    });
    const runtime = createMockRuntime();
    runtime.setNextResults([[{ tenant_id: 7, id: 1 }], [{ tenant_id: 7, id: 10 }], []]);

    await executeNestedCreateMutation({
      context: { ...getTestContext(), contract },
      runtime,
      modelName: 'Parent',
      data: {
        tenant_id: 7,
        id: 1,
        children: (children: { connect: (criterion: Record<string, unknown>) => unknown }) =>
          children.connect({ id: 10 }),
      } as never,
    });

    const link = (
      findJunctionDml(runtime, 'insert', 'parent_child').rows as ReadonlyArray<
        Record<string, unknown>
      >
    )[0]!;
    expect(Object.keys(link).sort()).toEqual(['child_id', 'parent_id', 'tenant_id']);
  });

  it('executeNestedUpdateMutation() routes M:N connect through a junction INSERT', async () => {
    const contract = buildManyToManyContract({
      junctionTable: 'parent_child',
      parentColumns: ['parent_id'],
      childColumns: ['child_id'],
      targetColumns: ['id'],
    });
    const runtime = createMockRuntime();
    runtime.setNextResults([[{ id: 1 }], [{ id: 10 }], []]);

    await executeNestedUpdateMutation({
      context: { ...getTestContext(), contract },
      runtime,
      modelName: 'Parent',
      filters: [BinaryExpr.eq(ColumnRef.of('parents', 'id'), LiteralExpr.of(1))],
      data: {
        children: (children: { connect: (criterion: Record<string, unknown>) => unknown }) =>
          children.connect({ id: 10 }),
      } as never,
    });

    const insert = findJunctionDml(runtime, 'insert', 'parent_child');
    expect(insert.kind).toBe('insert');
    expect((runtime.executions.at(-1)!.plan as { params: readonly unknown[] }).params).toEqual([
      1, 10,
    ]);
  });

  it('executeNestedUpdateMutation() routes M:N disconnect through a junction DELETE', async () => {
    const contract = buildManyToManyContract({
      junctionTable: 'parent_child',
      parentColumns: ['parent_id'],
      childColumns: ['child_id'],
      targetColumns: ['id'],
    });
    const runtime = createMockRuntime();
    runtime.setNextResults([[{ id: 1 }], [{ id: 10 }], []]);

    await executeNestedUpdateMutation({
      context: { ...getTestContext(), contract },
      runtime,
      modelName: 'Parent',
      filters: [BinaryExpr.eq(ColumnRef.of('parents', 'id'), LiteralExpr.of(1))],
      data: {
        children: (children: {
          disconnect: (criteria: readonly Record<string, unknown>[]) => unknown;
        }) => children.disconnect([{ id: 10 }]),
      } as never,
    });

    const del = findJunctionDml(runtime, 'delete', 'parent_child');
    expect(del.kind).toBe('delete');
    expect(collectLiterals(del.where).sort()).toEqual([1, 10]);
  });

  it('executeNestedCreateMutation() rejects M:N disconnect (update-only)', async () => {
    const contract = buildManyToManyContract({
      junctionTable: 'parent_child',
      parentColumns: ['parent_id'],
      childColumns: ['child_id'],
      targetColumns: ['id'],
    });
    const runtime = createMockRuntime();
    runtime.setNextResults([[{ id: 1 }]]);

    await expect(
      executeNestedCreateMutation({
        context: { ...getTestContext(), contract },
        runtime,
        namespaceId: 'public',
        modelName: 'Parent',
        data: {
          id: 1,
          children: (children: {
            disconnect: (criteria: readonly Record<string, unknown>[]) => unknown;
          }) => children.disconnect([{ id: 10 }]),
        } as never,
      }),
    ).rejects.toThrow(/disconnect\(\) is only supported in update\(\) nested mutations/);
  });

  it('executeNestedCreateMutation() rejects M:N create when junction has required payload columns', async () => {
    const contract = getTestContract();
    const runtime = createMockRuntime();
    runtime.setNextResults([[{ id: 1, name: 'Alice', email: 'alice@example.com' }]]);

    await expect(
      executeNestedCreateMutation({
        context: { ...getTestContext(), contract },
        runtime,
        modelName: 'User',
        data: {
          id: 1,
          name: 'Alice',
          email: 'alice@example.com',
          roles: (roles: { create: (rows: readonly Record<string, unknown>[]) => unknown }) =>
            roles.create([{ id: 'admin' }]),
        } as never,
      }),
    ).rejects.toThrow(
      /Cannot `create` on relation `roles`: its junction `user_roles` has required column\(s\) `level`/,
    );
  });

  it('executeNestedCreateMutation() rejects M:N connect when junction has required payload columns', async () => {
    const contract = getTestContract();
    const runtime = createMockRuntime();
    runtime.setNextResults([[{ id: 1, name: 'Alice', email: 'alice@example.com' }]]);

    await expect(
      executeNestedCreateMutation({
        context: { ...getTestContext(), contract },
        runtime,
        modelName: 'User',
        data: {
          id: 1,
          name: 'Alice',
          email: 'alice@example.com',
          roles: (roles: { connect: (criterion: Record<string, unknown>) => unknown }) =>
            roles.connect({ id: 'admin' }),
        } as never,
      }),
    ).rejects.toThrow(
      /Cannot `connect` on relation `roles`: its junction `user_roles` has required column\(s\) `level`/,
    );
  });

  it('executeNestedUpdateMutation() allows disconnect on junction with required payload columns', async () => {
    const contract = getTestContract();
    const runtime = createMockRuntime();
    runtime.setNextResults([
      [{ id: 1, name: 'Alice', email: 'alice@example.com' }],
      [{ id: 'admin' }],
      [],
    ]);

    await executeNestedUpdateMutation({
      context: { ...getTestContext(), contract },
      runtime,
      modelName: 'User',
      filters: [userIdFilter],
      data: {
        roles: (roles: { disconnect: (criteria: readonly Record<string, unknown>[]) => unknown }) =>
          roles.disconnect([{ id: 'admin' }]),
      } as never,
    });

    const del = findJunctionDml(runtime, 'delete', 'user_roles');
    expect(del.kind).toBe('delete');
  });

  it('executeNestedCreateMutation() allows M:N create on pure junction (no required payload)', async () => {
    const contract = getTestContract();
    const runtime = createMockRuntime();
    runtime.setNextResults([
      [{ id: 1, name: 'Alice', email: 'alice@example.com' }],
      [{ id: 'ts' }],
      [],
    ]);

    const created = await executeNestedCreateMutation({
      context: { ...getTestContext(), contract },
      runtime,
      modelName: 'User',
      data: {
        id: 1,
        name: 'Alice',
        email: 'alice@example.com',
        tags: (tags: { create: (rows: readonly Record<string, unknown>[]) => unknown }) =>
          tags.create([{ id: 'ts' }]),
      } as never,
    });

    expect(created).toEqual({ id: 1, name: 'Alice', email: 'alice@example.com' });
    const insert = findJunctionDml(runtime, 'insert', 'user_tags');
    expect(insert.kind).toBe('insert');
  });

  it('executeNestedCreateMutation() supports parent-owned nested create() payloads', async () => {
    const contract = getTestContract();
    const runtime = createMockRuntime();
    runtime.setNextResults([
      [{ id: 5, name: 'Author', email: 'author@example.com' }],
      [{ id: 1, title: 'Post', user_id: 5, views: 1 }],
    ]);

    const created = await executeNestedCreateMutation({
      context: { ...getTestContext(), contract },
      runtime,
      namespaceId: 'public',
      modelName: 'Post',
      data: {
        id: 1,
        title: 'Post',
        views: 1,
        author: (author: { create: (rows: readonly Record<string, unknown>[]) => unknown }) =>
          author.create([
            {
              id: 5,
              name: 'Author',
              email: 'author@example.com',
            },
          ]),
      } as never,
    });

    expect(created).toEqual({ id: 1, title: 'Post', userId: 5, views: 1 });
  });

  it('executeNestedCreateMutation() tolerates sparse parent/child column pairs', async () => {
    const contract = getTestContract();
    const sparseAuthorRelation = withPatchedDomainModels(contract, (models) => {
      const post = models['Post'] as { relations: { author: Record<string, unknown> } };
      return {
        ...models,
        Post: {
          ...post,
          relations: {
            ...post.relations,
            author: {
              ...post.relations.author,
              on: {
                localFields: [undefined, 'userId'] as unknown as readonly string[],
                targetFields: ['id', 'id'],
              },
            },
          },
        },
      };
    });
    const runtime = createMockRuntime();
    runtime.setNextResults([
      [{ id: 5, name: 'Author', email: 'author@example.com' }],
      [{ id: 1, title: 'Post', user_id: 5, views: 1 }],
    ]);

    const created = await executeNestedCreateMutation({
      context: { ...getTestContext(), contract: sparseAuthorRelation },
      runtime,
      namespaceId: 'public',
      modelName: 'Post',
      data: {
        id: 1,
        title: 'Post',
        views: 1,
        author: (author: { connect: (criterion: Record<string, unknown>) => unknown }) =>
          author.connect({ id: 5 }),
      } as never,
    });

    expect(created).toEqual({ id: 1, title: 'Post', userId: 5, views: 1 });
  });

  it('executeNestedUpdateMutation() returns null when no row matches filters', async () => {
    const contract = getTestContract();
    const runtime = createMockRuntime();
    runtime.setNextResults([[]]);

    const updated = await executeNestedUpdateMutation({
      context: { ...getTestContext(), contract },
      runtime,
      namespaceId: 'public',
      modelName: 'User',
      filters: [userIdFilter],
      data: { name: 'Alice Updated' } as never,
    });

    expect(updated).toBeNull();
  });

  it('executeNestedUpdateMutation() applies parent-owned disconnect updates', async () => {
    const contract = getTestContract();
    const runtime = createMockRuntime();
    runtime.setNextResults([
      [{ id: 1, title: 'Post', user_id: 5, views: 10 }],
      [{ id: 1, title: 'Post', user_id: null, views: 10 }],
    ]);

    const updated = await executeNestedUpdateMutation({
      context: { ...getTestContext(), contract },
      runtime,
      namespaceId: 'public',
      modelName: 'Post',
      filters: [postIdFilter],
      data: {
        author: (author: { disconnect: () => unknown }) => author.disconnect(),
      } as never,
    });

    expect(updated).toEqual({ id: 1, title: 'Post', userId: null, views: 10 });
  });

  it('executeNestedUpdateMutation() keeps existing rows when update-returning returns no row', async () => {
    const contract = getTestContract();
    const runtime = createMockRuntime();
    runtime.setNextResults([[{ id: 1, name: 'Alice', email: 'alice@example.com' }], []]);

    const updated = await executeNestedUpdateMutation({
      context: { ...getTestContext(), contract },
      runtime,
      namespaceId: 'public',
      modelName: 'User',
      filters: [userIdFilter],
      data: { name: 'Updated' } as never,
    });

    expect(updated).toEqual({ id: 1, name: 'Alice', email: 'alice@example.com' });
  });

  it('executeNestedUpdateMutation() validates child-owned connect and disconnect criteria', async () => {
    const contract = getTestContract();
    const runtime = createMockRuntime();

    runtime.setNextResults([[{ id: 1, name: 'Alice', email: 'alice@example.com' }]]);
    await expect(
      executeNestedUpdateMutation({
        context: { ...getTestContext(), contract },
        runtime,
        namespaceId: 'public',
        modelName: 'User',
        filters: [userIdFilter],
        data: {
          posts: (posts: { connect: (criteria: readonly Record<string, unknown>[]) => unknown }) =>
            posts.connect([{}]),
        } as never,
      }),
    ).rejects.toThrow(/requires non-empty criterion/);

    runtime.setNextResults([[{ id: 1, name: 'Alice', email: 'alice@example.com' }], []]);
    const connected = await executeNestedUpdateMutation({
      context: { ...getTestContext(), contract },
      runtime,
      namespaceId: 'public',
      modelName: 'User',
      filters: [userIdFilter],
      data: {
        posts: (posts: { connect: (criterion: Record<string, unknown>) => unknown }) =>
          posts.connect({ id: 11 }),
      } as never,
    });

    expect(connected).toEqual({ id: 1, name: 'Alice', email: 'alice@example.com' });

    runtime.setNextResults([[{ id: 1, name: 'Alice', email: 'alice@example.com' }], []]);
    const disconnected = await executeNestedUpdateMutation({
      context: { ...getTestContext(), contract },
      runtime,
      namespaceId: 'public',
      modelName: 'User',
      filters: [userIdFilter],
      data: {
        posts: (posts: { disconnect: () => unknown }) => posts.disconnect(),
      } as never,
    });

    expect(disconnected).toEqual({ id: 1, name: 'Alice', email: 'alice@example.com' });

    runtime.setNextResults([[{ id: 1, name: 'Alice', email: 'alice@example.com' }]]);
    await expect(
      executeNestedUpdateMutation({
        context: { ...getTestContext(), contract },
        runtime,
        namespaceId: 'public',
        modelName: 'User',
        filters: [userIdFilter],
        data: {
          posts: (posts: {
            disconnect: (criteria: readonly Record<string, unknown>[]) => unknown;
          }) => posts.disconnect([{}]),
        } as never,
      }),
    ).rejects.toThrow(/requires non-empty criterion/);
  });

  it('executeNestedUpdateMutation() supports composite child joins and sparse relation columns', async () => {
    const contract = getTestContract();
    const compositeRelationContract = withPatchedDomainModels(contract, (models) => {
      const user = models['User'] as { relations: { posts: Record<string, unknown> } };
      return {
        ...models,
        User: {
          ...user,
          relations: {
            ...user.relations,
            posts: {
              ...user.relations.posts,
              on: {
                localFields: [undefined, 'id', 'email'] as unknown as readonly string[],
                targetFields: ['userId', 'userId', 'title'],
              },
            },
          },
        },
      };
    });
    const runtime = createMockRuntime();
    runtime.setNextResults([[{ id: 1, name: 'Alice', email: 'alice@example.com' }], []]);

    const updated = await executeNestedUpdateMutation({
      context: { ...getTestContext(), contract: compositeRelationContract },
      runtime,
      namespaceId: 'public',
      modelName: 'User',
      filters: [userIdFilter],
      data: {
        posts: (posts: { disconnect: () => unknown }) => posts.disconnect(),
      } as never,
    });

    expect(updated).toEqual({ id: 1, name: 'Alice', email: 'alice@example.com' });
  });

  it('executeNestedUpdateMutation() validates parent row shape for child-owned mutations', async () => {
    const contract = getTestContract();
    const runtime = createMockRuntime();
    runtime.setNextResults([[{ name: 'Alice', email: 'alice@example.com' }]]);

    await expect(
      executeNestedUpdateMutation({
        context: { ...getTestContext(), contract },
        runtime,
        namespaceId: 'public',
        modelName: 'User',
        filters: [userIdFilter],
        data: {
          posts: (posts: { connect: (criterion: Record<string, unknown>) => unknown }) =>
            posts.connect({ id: 10 }),
        } as never,
      }),
    ).rejects.toThrow(/requires parent field "id"/);
  });

  it('executeNestedCreateMutation() reuses scope directly when runtime lacks transaction and connection', async () => {
    const runtime = createMockRuntime();
    runtime.setNextResults([[{ id: 1, name: 'Alice', email: 'alice@test.com' }]]);

    const executeSpy = vi.spyOn(runtime, 'execute');

    const created = await executeNestedCreateMutation({
      context: getTestContext(),
      runtime,
      namespaceId: 'public',
      modelName: 'User',
      data: { id: 1, name: 'Alice', email: 'alice@test.com' } as never,
    });

    expect(created).toEqual({ id: 1, name: 'Alice', email: 'alice@test.com' });
    expect(executeSpy).toHaveBeenCalledTimes(1);
  });

  it('withMutationScope reuses runtime directly when no transaction or connection method exists', async () => {
    const runtime = createMockRuntime();
    runtime.setNextResults([[{ id: 1, name: 'Alice', email: 'alice@test.com' }]]);

    expect(runtime.transaction).toBeUndefined();
    expect(runtime.connection).toBeUndefined();

    const created = await executeNestedCreateMutation({
      context: getTestContext(),
      runtime,
      namespaceId: 'public',
      modelName: 'User',
      data: { id: 1, name: 'Alice', email: 'alice@test.com' } as never,
    });

    expect(created).toEqual({ id: 1, name: 'Alice', email: 'alice@test.com' });
    expect(runtime.executions).toHaveLength(1);
  });
});
