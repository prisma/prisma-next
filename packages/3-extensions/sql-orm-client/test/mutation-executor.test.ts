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
import { createMockRuntime, getTestContract } from './helpers';

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
      hasNestedMutationCallbacks(contract, 'User', {
        posts: (posts: { connect: (criterion: Record<string, unknown>) => unknown }) =>
          posts.connect({ id: 1 }),
      }),
    ).toBe(true);

    expect(
      hasNestedMutationCallbacks(contract, 'User', {
        posts: { kind: 'connect', criteria: [{ id: 1 }] },
      }),
    ).toBe(false);

    expect(
      hasNestedMutationCallbacks(contract, 'User', {
        name: () => ({ kind: 'connect' }),
      }),
    ).toBe(false);
  });

  it('hasNestedMutationCallbacks() tolerates malformed relation metadata and unknown models', () => {
    const contract = getTestContract();
    const malformed = {
      ...contract,
      relations: {
        ...contract.relations,
        users: {
          notObject: 1,
          missingTo: {
            cardinality: '1:N',
            on: {
              parentCols: ['id'],
              childCols: ['user_id'],
            },
          },
          badCols: {
            to: 'Post',
            cardinality: '1:N',
            on: {
              parentCols: 'id',
              childCols: ['user_id'],
            },
          },
          posts: {
            to: 'Post',
            cardinality: 'INVALID',
            on: {
              parentCols: ['id'],
              childCols: ['user_id'],
            },
          },
        },
      },
    } as unknown as TestContract;

    expect(
      hasNestedMutationCallbacks(malformed, 'User', {
        posts: (posts: { connect: (criterion: Record<string, unknown>) => unknown }) =>
          posts.connect({ id: 1 }),
      }),
    ).toBe(true);

    expect(
      hasNestedMutationCallbacks(contract, 'UnknownModel', {
        anything: () => ({ kind: 'connect' }),
      }),
    ).toBe(false);
  });

  it('buildPrimaryKeyFilterFromRow() resolves mapped keys and throws when missing', () => {
    const contract = getTestContract();

    expect(buildPrimaryKeyFilterFromRow(contract, 'User', { id: 7 })).toEqual({ id: 7 });

    expect(() => buildPrimaryKeyFilterFromRow(contract, 'User', {})).toThrow(
      /Missing primary key field "id"/,
    );
  });

  it('buildPrimaryKeyFilterFromRow() falls back when column mappings are missing', () => {
    const contract = getTestContract();

    const withoutColumnToField = {
      ...contract,
      mappings: {
        ...contract.mappings,
        columnToField: {},
      },
    } as unknown as TestContract;

    expect(buildPrimaryKeyFilterFromRow(withoutColumnToField, 'User', { id: 1 })).toEqual({
      id: 1,
    });

    const withCustomPk = {
      ...withoutColumnToField,
      storage: {
        ...withoutColumnToField.storage,
        tables: {
          ...withoutColumnToField.storage.tables,
          users: {
            ...withoutColumnToField.storage.tables.users,
            primaryKey: {
              columns: ['pk_id'],
            },
          },
        },
      },
    } as unknown as TestContract;

    expect(buildPrimaryKeyFilterFromRow(withCustomPk, 'User', { pk_id: 99 })).toEqual({
      pk_id: 99,
    });
  });

  it('executeNestedCreateMutation() commits transactions on success', async () => {
    const contract = getTestContract();
    const runtime = createMockRuntime();
    runtime.setNextResults([[{ id: 1, name: 'Alice', email: 'alice@example.com' }]]);
    const transactional = withTransaction(runtime);

    const created = await executeNestedCreateMutation({
      contract,
      runtime: transactional.runtime,
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
      contract,
      runtime: runtimeWithBareTransaction,
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
        contract,
        runtime: transactional.runtime,
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
      contract,
      runtime: scopedRuntime,
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
        contract,
        runtime,
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
        contract,
        runtime,
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
        contract,
        runtime,
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
        contract,
        runtime,
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
        contract,
        runtime,
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
        contract,
        runtime,
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
        contract,
        runtime,
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
        contract,
        runtime,
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

  it('executeNestedCreateMutation() rejects M:N nested mutations', async () => {
    const contract = getTestContract();
    const runtime = createMockRuntime();
    const withManyToMany = {
      ...contract,
      relations: {
        ...contract.relations,
        users: {
          ...contract.relations.users,
          posts: {
            ...contract.relations.users.posts,
            cardinality: 'M:N',
          },
        },
      },
    } as unknown as TestContract;

    await expect(
      executeNestedCreateMutation({
        contract: withManyToMany,
        runtime,
        modelName: 'User',
        data: {
          id: 1,
          name: 'Alice',
          email: 'alice@example.com',
          posts: (posts: { connect: (criterion: Record<string, unknown>) => unknown }) =>
            posts.connect({ id: 10 }),
        } as never,
      }),
    ).rejects.toThrow(/M:N nested mutations are not supported yet/);
  });

  it('executeNestedCreateMutation() supports parent-owned nested create() payloads', async () => {
    const contract = getTestContract();
    const runtime = createMockRuntime();
    runtime.setNextResults([
      [{ id: 5, name: 'Author', email: 'author@example.com' }],
      [{ id: 1, title: 'Post', user_id: 5, views: 1 }],
    ]);

    const created = await executeNestedCreateMutation({
      contract,
      runtime,
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
    const sparseAuthorRelation = {
      ...contract,
      relations: {
        ...contract.relations,
        posts: {
          ...contract.relations.posts,
          author: {
            ...contract.relations.posts.author,
            on: {
              parentCols: [undefined, 'user_id'],
              childCols: ['id', 'id'],
            },
          },
        },
      },
    } as unknown as TestContract;
    const runtime = createMockRuntime();
    runtime.setNextResults([
      [{ id: 5, name: 'Author', email: 'author@example.com' }],
      [{ id: 1, title: 'Post', user_id: 5, views: 1 }],
    ]);

    const created = await executeNestedCreateMutation({
      contract: sparseAuthorRelation,
      runtime,
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
      contract,
      runtime,
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
      contract,
      runtime,
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
      contract,
      runtime,
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
        contract,
        runtime,
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
      contract,
      runtime,
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
      contract,
      runtime,
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
        contract,
        runtime,
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
    const compositeRelationContract = {
      ...contract,
      relations: {
        ...contract.relations,
        users: {
          ...contract.relations.users,
          posts: {
            ...contract.relations.users.posts,
            on: {
              parentCols: [undefined, 'id', 'email'],
              childCols: ['user_id', 'user_id', 'title'],
            },
          },
        },
      },
    } as unknown as TestContract;
    const runtime = createMockRuntime();
    runtime.setNextResults([[{ id: 1, name: 'Alice', email: 'alice@example.com' }], []]);

    const updated = await executeNestedUpdateMutation({
      contract: compositeRelationContract,
      runtime,
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
        contract,
        runtime,
        modelName: 'User',
        filters: [userIdFilter],
        data: {
          posts: (posts: { connect: (criterion: Record<string, unknown>) => unknown }) =>
            posts.connect({ id: 10 }),
        } as never,
      }),
    ).rejects.toThrow(/requires parent field "id"/);
  });
});
