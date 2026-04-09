import { AsyncIterableResult } from '@prisma-next/runtime-executor';
import { describe, expect, it } from 'vitest';
import { resolvePolymorphismInfo } from '../src/collection-contract';
import {
  acquireRuntimeScope,
  augmentSelectionForJoinColumns,
  createRowEnvelope,
  mapModelDataToStorageRow,
  mapPolymorphicRow,
  mapResultRows,
  mapStorageRowToModelFields,
  stripHiddenMappedFields,
} from '../src/collection-runtime';
import type { TestContract } from './helpers';
import { getTestContract } from './helpers';

describe('collection-runtime', () => {
  const contract = getTestContract();

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
      mapStorageRowToModelFields(contract, 'Post', { id: 1, user_id: 2, custom: true }),
    ).toEqual({
      id: 1,
      userId: 2,
      custom: true,
    });
    expect(mapStorageRowToModelFields(contract, 'UnknownModel', { id: 1 })).toEqual({ id: 1 });
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
    stripHiddenMappedFields(contract, 'Post', mapped, ['user_id']);

    expect(mapped).toEqual({ id: 1, title: 'A' });
    stripHiddenMappedFields(contract, 'Post', mapped, []);
    expect(mapped).toEqual({ id: 1, title: 'A' });
  });

  it('stripHiddenMappedFields() falls back to raw column names when mappings are missing', () => {
    const unknownTableMapped = { custom_col: 1 };
    stripHiddenMappedFields(contract, 'UnknownModel', unknownTableMapped, ['custom_col']);
    expect(unknownTableMapped).toEqual({});

    const unknownColumnMapped = { id: 1, custom_col: 2 };
    stripHiddenMappedFields(contract, 'User', unknownColumnMapped, ['custom_col']);
    expect(unknownColumnMapped).toEqual({ id: 1 });
  });

  it('createRowEnvelope() retains raw and mapped values', () => {
    expect(createRowEnvelope(contract, 'Post', { id: 1, user_id: 2 })).toEqual({
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

function buildPolyContract(): TestContract {
  const base = getTestContract();
  const raw = JSON.parse(JSON.stringify(base));

  raw.models.Task = {
    fields: {
      id: { nullable: false, type: { kind: 'scalar', codecId: 'pg/int4@1' } },
      title: { nullable: false, type: { kind: 'scalar', codecId: 'pg/text@1' } },
      type: { nullable: false, type: { kind: 'scalar', codecId: 'pg/text@1' } },
    },
    relations: {},
    storage: {
      table: 'tasks',
      fields: {
        id: { column: 'id' },
        title: { column: 'title' },
        type: { column: 'type' },
      },
    },
    discriminator: { field: 'type' },
    variants: { Bug: { value: 'bug' }, Feature: { value: 'feature' } },
  };

  raw.models.Bug = {
    fields: {
      severity: { nullable: true, type: { kind: 'scalar', codecId: 'pg/text@1' } },
    },
    relations: {},
    storage: { table: 'tasks', fields: { severity: { column: 'severity' } } },
    base: 'Task',
  };

  raw.models.Feature = {
    fields: {
      priority: { nullable: false, type: { kind: 'scalar', codecId: 'pg/int4@1' } },
    },
    relations: {},
    storage: { table: 'features', fields: { priority: { column: 'priority' } } },
    base: 'Task',
  };

  raw.storage.tables.tasks = {
    columns: {
      id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
      title: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
      type: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
      severity: { nativeType: 'text', codecId: 'pg/text@1', nullable: true },
    },
    primaryKey: { columns: ['id'] },
    uniques: [],
    indexes: [],
    foreignKeys: [],
  };

  raw.storage.tables.features = {
    columns: {
      id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
      priority: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
    },
    primaryKey: { columns: ['id'] },
    uniques: [],
    indexes: [],
    foreignKeys: [],
  };

  return raw as TestContract;
}

describe('mapPolymorphicRow()', () => {
  it('maps STI Bug row: includes base + Bug fields, excludes Feature fields', () => {
    const contract = buildPolyContract();
    const polyInfo = resolvePolymorphismInfo(contract, 'Task')!;

    const row = { id: 1, title: 'Crash', type: 'bug', severity: 'critical' };
    const result = mapPolymorphicRow(contract, 'Task', polyInfo, row);

    expect(result).toEqual({ id: 1, title: 'Crash', type: 'bug', severity: 'critical' });
  });

  it('maps STI row and strips non-matching variant columns (NULL for other STI variants)', () => {
    const contract = buildPolyContract();
    const polyInfo = resolvePolymorphismInfo(contract, 'Task')!;

    const row = { id: 1, title: 'Crash', type: 'bug', severity: 'critical', priority: null };
    const result = mapPolymorphicRow(contract, 'Task', polyInfo, row);

    expect(result).toEqual({ id: 1, title: 'Crash', type: 'bug', severity: 'critical' });
    expect(result).not.toHaveProperty('priority');
  });

  it('maps MTI Feature row: includes base + Feature fields', () => {
    const contract = buildPolyContract();
    const polyInfo = resolvePolymorphismInfo(contract, 'Task')!;

    const row = { id: 2, title: 'Dark mode', type: 'feature', severity: null, priority: 1 };
    const result = mapPolymorphicRow(contract, 'Task', polyInfo, row);

    expect(result).toEqual({ id: 2, title: 'Dark mode', type: 'feature', priority: 1 });
    expect(result).not.toHaveProperty('severity');
  });

  it('maps row with known variant using variantName override', () => {
    const contract = buildPolyContract();
    const polyInfo = resolvePolymorphismInfo(contract, 'Task')!;

    const row = { id: 1, title: 'Crash', type: 'bug', severity: 'high' };
    const result = mapPolymorphicRow(contract, 'Task', polyInfo, row, 'Bug');

    expect(result).toEqual({ id: 1, title: 'Crash', type: 'bug', severity: 'high' });
  });

  it('falls back to base-only mapping for unknown discriminator values', () => {
    const contract = buildPolyContract();
    const polyInfo = resolvePolymorphismInfo(contract, 'Task')!;

    const row = { id: 3, title: 'Unknown', type: 'epic', severity: null, priority: null };
    const result = mapPolymorphicRow(contract, 'Task', polyInfo, row);

    expect(result).toEqual({ id: 3, title: 'Unknown', type: 'epic' });
  });
});
