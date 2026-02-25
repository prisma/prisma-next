import { AsyncIterableResult } from '@prisma-next/runtime-executor';
import { describe, expect, it } from 'vitest';
import {
  acquireRuntimeScope,
  augmentSelectionForJoinColumns,
  createRowEnvelope,
  mapModelDataToStorageRow,
  mapResultRows,
  mapStorageRowToModelFields,
  stripHiddenMappedFields,
} from '../src/collection-runtime';
import { createTestContract } from './helpers';

describe('collection-runtime', () => {
  const contract = createTestContract();

  it('augmentSelectionForJoinColumns() handles undefined and complete selections', () => {
    expect(augmentSelectionForJoinColumns(undefined, ['id'])).toEqual({
      selectedForQuery: undefined,
      hiddenColumns: [],
    });

    expect(augmentSelectionForJoinColumns(['id', 'name'], ['id'])).toEqual({
      selectedForQuery: ['id', 'name'],
      hiddenColumns: [],
    });
  });

  it('augmentSelectionForJoinColumns() appends missing required columns', () => {
    expect(augmentSelectionForJoinColumns(['name'], ['id', 'name'])).toEqual({
      selectedForQuery: ['name', 'id'],
      hiddenColumns: ['id'],
    });
  });

  it('mapStorageRowToModelFields() maps known columns and falls back otherwise', () => {
    expect(
      mapStorageRowToModelFields(contract, 'posts', { id: 1, user_id: 2, custom: true }),
    ).toEqual({
      id: 1,
      userId: 2,
      custom: true,
    });
    expect(mapStorageRowToModelFields(contract, 'unknown_table', { id: 1 })).toEqual({ id: 1 });
  });

  it('mapModelDataToStorageRow() maps fields and skips undefined values', () => {
    expect(
      mapModelDataToStorageRow(contract, 'Post', {
        id: 1,
        userId: 2,
        views: undefined,
        custom: 'x',
      }),
    ).toEqual({
      id: 1,
      user_id: 2,
      custom: 'x',
    });
  });

  it('mapModelDataToStorageRow() falls back to input keys when model mappings are missing', () => {
    expect(
      mapModelDataToStorageRow(contract, 'UnknownModel', {
        customField: 1,
        optionalField: undefined,
      }),
    ).toEqual({
      customField: 1,
    });
  });

  it('stripHiddenMappedFields() removes mapped fields for hidden columns', () => {
    const mapped = { id: 1, userId: 2, title: 'A' };
    stripHiddenMappedFields(contract, 'posts', mapped, ['user_id']);

    expect(mapped).toEqual({ id: 1, title: 'A' });
    stripHiddenMappedFields(contract, 'posts', mapped, []);
    expect(mapped).toEqual({ id: 1, title: 'A' });
  });

  it('stripHiddenMappedFields() falls back to raw column names when mappings are missing', () => {
    const unknownTableMapped = { custom_col: 1 };
    stripHiddenMappedFields(contract, 'unknown_table', unknownTableMapped, ['custom_col']);
    expect(unknownTableMapped).toEqual({});

    const unknownColumnMapped = { id: 1, custom_col: 2 };
    stripHiddenMappedFields(contract, 'users', unknownColumnMapped, ['custom_col']);
    expect(unknownColumnMapped).toEqual({ id: 1 });
  });

  it('createRowEnvelope() retains raw and mapped values', () => {
    expect(createRowEnvelope(contract, 'posts', { id: 1, user_id: 2 })).toEqual({
      raw: { id: 1, user_id: 2 },
      mapped: { id: 1, userId: 2 },
    });
  });

  it('mapResultRows() maps async iterable rows', async () => {
    const source = new AsyncIterableResult(
      (async function* () {
        yield 1;
        yield 2;
      })(),
    );

    const mapped = mapResultRows(source, (value) => value * 10);
    expect(await mapped.toArray()).toEqual([10, 20]);
  });

  it('acquireRuntimeScope() handles direct runtimes and connection scopes', async () => {
    const directRuntime = {
      execute: () => new AsyncIterableResult((async function* () {})()),
    } as never;
    const direct = await acquireRuntimeScope(directRuntime);
    expect(direct.scope).toBe(directRuntime);
    expect(direct.release).toBeUndefined();

    let released = false;
    const connectionRuntime = {
      async connection() {
        return {
          execute: () => new AsyncIterableResult((async function* () {})()),
          release: async () => {
            released = true;
          },
        };
      },
    } as never;
    const scoped = await acquireRuntimeScope(connectionRuntime);
    expect(scoped.release).toBeTypeOf('function');
    await scoped.release?.();
    expect(released).toBe(true);

    const noReleaseRuntime = {
      async connection() {
        return {
          execute: () => new AsyncIterableResult((async function* () {})()),
        };
      },
    } as never;
    const noRelease = await acquireRuntimeScope(noReleaseRuntime);
    expect(noRelease.release).toBeUndefined();
  });

  it('acquireRuntimeScope() release callback falls back when release returns undefined', async () => {
    const runtime = {
      async connection() {
        return {
          execute: () => new AsyncIterableResult((async function* () {})()),
          release: () => undefined,
        };
      },
    } as never;

    const scoped = await acquireRuntimeScope(runtime);
    await expect(scoped.release?.()).resolves.toBeUndefined();
  });
});
