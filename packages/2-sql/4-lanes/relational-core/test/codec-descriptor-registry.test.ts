import type { CodecDescriptor } from '@prisma-next/framework-components/codec';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import {
  buildSqlNamespace,
  SqlStorage,
  type SqlStorageTypeEntry,
  type StorageTableInput,
} from '@prisma-next/sql-contract/types';
import { ifDefined } from '@prisma-next/utils/defined';
import { describe, expect, it } from 'vitest';
import type { AnyCodecDescriptor } from '../src/ast/codec-types';
import { buildCodecDescriptorRegistry } from '../src/codec-descriptor-registry';

const stub = (codecId: string, targetTypes: readonly string[]): AnyCodecDescriptor =>
  ({
    codecId,
    traits: [],
    targetTypes,
    isParameterized: false,
    paramsSchema: undefined,
    factory: () => () => ({ id: codecId }) as never,
  }) as unknown as AnyCodecDescriptor;

describe('buildCodecDescriptorRegistry', () => {
  it('descriptorFor returns the registered descriptor by codec id', () => {
    const a = stub('lib/a@1', ['ta']);
    const b = stub('lib/b@1', ['tb']);
    const registry = buildCodecDescriptorRegistry([a, b]);

    expect(registry.descriptorFor('lib/a@1')).toBe(a as unknown as CodecDescriptor<unknown>);
    expect(registry.descriptorFor('lib/b@1')).toBe(b as unknown as CodecDescriptor<unknown>);
  });

  it('descriptorFor returns undefined for an unknown codec id', () => {
    const registry = buildCodecDescriptorRegistry([stub('lib/a@1', ['ta'])]);
    expect(registry.descriptorFor('lib/missing@1')).toBeUndefined();
  });

  it('values() yields all registered descriptors in registration order', () => {
    const a = stub('lib/a@1', ['ta']);
    const b = stub('lib/b@1', ['tb']);
    const c = stub('lib/c@1', ['tc']);
    const registry = buildCodecDescriptorRegistry([a, b, c]);

    expect([...registry.values()]).toEqual([a, b, c]);
  });

  it('byTargetType groups descriptors that advertise the same target type', () => {
    const a = stub('lib/a@1', ['shared']);
    const b = stub('lib/b@1', ['shared', 'extra']);
    const registry = buildCodecDescriptorRegistry([a, b]);

    expect(registry.byTargetType('shared')).toEqual([a, b]);
    expect(registry.byTargetType('extra')).toEqual([b]);
  });

  it('byTargetType returns an empty frozen array for an unknown target type', () => {
    const registry = buildCodecDescriptorRegistry([stub('lib/a@1', ['ta'])]);
    const result = registry.byTargetType('unknown');
    expect(result).toEqual([]);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('throws when a codec id is registered twice', () => {
    const a = stub('lib/dup@1', ['ta']);
    const a2 = stub('lib/dup@1', ['tb']);
    expect(() => buildCodecDescriptorRegistry([a, a2])).toThrowError(
      /Duplicate codec descriptor id: 'lib\/dup@1'/,
    );
  });
});

describe('buildCodecDescriptorRegistry — codecRefForColumn', () => {
  function storageWith(parts: {
    tables: Record<string, StorageTableInput>;
    types?: Record<string, SqlStorageTypeEntry>;
  }): SqlStorage {
    return new SqlStorage({
      storageHash: 'sha256:test' as SqlStorage['storageHash'],
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: buildSqlNamespace({
          id: UNBOUND_NAMESPACE_ID,
          entries: { table: parts.tables },
        }),
      },
      ...ifDefined('types', parts.types),
    });
  }

  const descriptors = [stub('pg/vector@1', ['vector']), stub('pg/text@1', ['text'])];

  it('returns undefined when the registry was built without storage', () => {
    const registry = buildCodecDescriptorRegistry(descriptors);
    expect(registry.codecRefForColumn('Doc', 'embedding')).toBeUndefined();
  });

  it('derives `{codecId, typeParams}` from `storage.types` for a typeRef column', () => {
    const storage = storageWith({
      tables: {
        Doc: {
          columns: {
            embedding: {
              nativeType: 'vector',
              codecId: 'pg/vector@1',
              nullable: false,
              typeRef: 'Vector1536',
            },
          },
          primaryKey: { columns: ['embedding'] },
          uniques: [],
          indexes: [],
          foreignKeys: [],
        },
      },
      types: {
        Vector1536: {
          kind: 'codec-instance',
          codecId: 'pg/vector@1',
          nativeType: 'vector',
          typeParams: { length: 1536 },
        },
      },
    });

    const registry = buildCodecDescriptorRegistry(descriptors, storage);
    expect(registry.codecRefForColumn('Doc', 'embedding')).toEqual({
      codecId: 'pg/vector@1',
      typeParams: { length: 1536 },
    });
  });

  it('derives `{codecId, typeParams}` from inline `column.typeParams` when no typeRef is set', () => {
    const storage = storageWith({
      tables: {
        Doc: {
          columns: {
            embedding: {
              nativeType: 'vector',
              codecId: 'pg/vector@1',
              nullable: false,
              typeParams: { length: 768 },
            },
          },
          primaryKey: { columns: ['embedding'] },
          uniques: [],
          indexes: [],
          foreignKeys: [],
        },
      },
    });

    const registry = buildCodecDescriptorRegistry(descriptors, storage);
    expect(registry.codecRefForColumn('Doc', 'embedding')).toEqual({
      codecId: 'pg/vector@1',
      typeParams: { length: 768 },
    });
  });

  it('emits `{codecId}` (typeParams undefined) for a non-parameterized column', () => {
    const storage = storageWith({
      tables: {
        User: {
          columns: {
            email: {
              nativeType: 'text',
              codecId: 'pg/text@1',
              nullable: false,
            },
          },
          primaryKey: { columns: ['email'] },
          uniques: [],
          indexes: [],
          foreignKeys: [],
        },
      },
    });

    const registry = buildCodecDescriptorRegistry(descriptors, storage);
    const ref = registry.codecRefForColumn('User', 'email');
    expect(ref).toEqual({ codecId: 'pg/text@1' });
    expect(ref?.typeParams).toBeUndefined();
  });

  it('returns undefined for an unknown table or column', () => {
    const storage = storageWith({
      tables: {
        User: {
          columns: {
            email: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
          },
          primaryKey: { columns: ['email'] },
          uniques: [],
          indexes: [],
          foreignKeys: [],
        },
      },
    });

    const registry = buildCodecDescriptorRegistry(descriptors, storage);
    expect(registry.codecRefForColumn('User', 'nope')).toBeUndefined();
    expect(registry.codecRefForColumn('NoSuchTable', 'whatever')).toBeUndefined();
  });

  it('returns undefined when the typeRef points at an undefined storage type', () => {
    const storage = storageWith({
      tables: {
        Doc: {
          columns: {
            embedding: {
              nativeType: 'vector',
              codecId: 'pg/vector@1',
              nullable: false,
              typeRef: 'Missing',
            },
          },
          primaryKey: { columns: ['embedding'] },
          uniques: [],
          indexes: [],
          foreignKeys: [],
        },
      },
    });

    const registry = buildCodecDescriptorRegistry(descriptors, storage);
    expect(registry.codecRefForColumn('Doc', 'embedding')).toBeUndefined();
  });
});
