import { createPostgresAdapter } from '@prisma-next/adapter-postgres/adapter';
import { codec, createCodecRegistry } from '@prisma-next/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { createSqlTypeMetadataRegistry } from '../src/type-metadata';
import type { SqlTypeMetadata } from '../src/types';

describe('createSqlTypeMetadataRegistry', () => {
  it('creates registry from adapter codec registry', () => {
    const adapterInstance = createPostgresAdapter();
    const codecRegistry = adapterInstance.profile.codecs();
    const types = createSqlTypeMetadataRegistry([{ codecRegistry }]);

    const entries = Array.from(types.values());
    expect(entries.length).toBeGreaterThan(0);

    // Check that we have some expected types
    const typeIds = entries.map((e) => e.typeId);
    expect(typeIds).toContain('pg/int4@1');
    expect(typeIds).toContain('pg/text@1');

    // Check that metadata has correct structure
    const int4Metadata = entries.find((e) => e.typeId === 'pg/int4@1');
    expect(int4Metadata).toBeDefined();
    expect(int4Metadata?.targetTypes).toContain('int4');
    expect(int4Metadata?.nativeType).toBe('integer');
  });

  it('creates registry from extension type metadata', () => {
    const extensionMetadata: ReadonlyArray<SqlTypeMetadata> = [
      {
        typeId: 'pg/vector@1',
        targetTypes: ['vector'],
        nativeType: 'vector',
      },
      {
        typeId: 'pg/custom@1',
        targetTypes: ['custom'],
        nativeType: 'custom_type',
      },
    ];

    const types = createSqlTypeMetadataRegistry([{ typeMetadata: extensionMetadata }]);

    const entries = Array.from(types.values());
    expect(entries.length).toBe(2);
    expect(entries.map((e) => e.typeId)).toContain('pg/vector@1');
    expect(entries.map((e) => e.typeId)).toContain('pg/custom@1');

    const vectorMetadata = entries.find((e) => e.typeId === 'pg/vector@1');
    expect(vectorMetadata).toBeDefined();
    expect(vectorMetadata?.targetTypes).toEqual(['vector']);
    expect(vectorMetadata?.nativeType).toBe('vector');
  });

  it('merges adapter codecs and extension metadata', () => {
    const adapterInstance = createPostgresAdapter();
    const codecRegistry = adapterInstance.profile.codecs();

    const extensionMetadata: ReadonlyArray<SqlTypeMetadata> = [
      {
        typeId: 'pg/vector@1',
        targetTypes: ['vector'],
        nativeType: 'vector',
      },
    ];

    const types = createSqlTypeMetadataRegistry([
      { codecRegistry },
      { typeMetadata: extensionMetadata },
    ]);

    const entries = Array.from(types.values());
    const typeIds = entries.map((e) => e.typeId);

    // Should have adapter types
    expect(typeIds).toContain('pg/int4@1');
    expect(typeIds).toContain('pg/text@1');

    // Should have extension types
    expect(typeIds).toContain('pg/vector@1');
  });

  it('adapter entries win over extension entries for same typeId', () => {
    const codecRegistry = createCodecRegistry();
    codecRegistry.register(
      codec({
        typeId: 'pg/custom@1',
        targetTypes: ['custom'],
        encode: (v: string) => v,
        decode: (v: string) => v,
        meta: {
          db: {
            sql: {
              postgres: {
                nativeType: 'adapter_type',
              },
            },
          },
        },
      }),
    );

    const extensionMetadata: ReadonlyArray<SqlTypeMetadata> = [
      {
        typeId: 'pg/custom@1',
        targetTypes: ['custom'],
        nativeType: 'extension_type',
      },
    ];

    const types = createSqlTypeMetadataRegistry([
      { codecRegistry },
      { typeMetadata: extensionMetadata },
    ]);

    const entries = Array.from(types.values());
    const customMetadata = entries.find((e) => e.typeId === 'pg/custom@1');

    expect(customMetadata).toBeDefined();
    // Adapter entry should win (nativeType from codec)
    expect(customMetadata?.nativeType).toBe('adapter_type');
  });

  it('later entries win over earlier entries for same typeId', () => {
    const codecRegistry1 = createCodecRegistry();
    codecRegistry1.register(
      codec({
        typeId: 'pg/custom@1',
        targetTypes: ['custom'],
        encode: (v: string) => v,
        decode: (v: string) => v,
        meta: {
          db: {
            sql: {
              postgres: {
                nativeType: 'first',
              },
            },
          },
        },
      }),
    );

    const codecRegistry2 = createCodecRegistry();
    codecRegistry2.register(
      codec({
        typeId: 'pg/custom@1',
        targetTypes: ['custom'],
        encode: (v: string) => v,
        decode: (v: string) => v,
        meta: {
          db: {
            sql: {
              postgres: {
                nativeType: 'second',
              },
            },
          },
        },
      }),
    );

    const types = createSqlTypeMetadataRegistry([
      { codecRegistry: codecRegistry1 },
      { codecRegistry: codecRegistry2 },
    ]);

    const entries = Array.from(types.values());
    const customMetadata = entries.find((e) => e.typeId === 'pg/custom@1');

    expect(customMetadata).toBeDefined();
    // Later entry should win
    expect(customMetadata?.nativeType).toBe('second');
  });

  it('handles empty sources', () => {
    const types = createSqlTypeMetadataRegistry([]);
    const entries = Array.from(types.values());
    expect(entries.length).toBe(0);
  });

  it('handles metadata without nativeType', () => {
    const extensionMetadata: ReadonlyArray<SqlTypeMetadata> = [
      {
        typeId: 'pg/abstract@1',
        targetTypes: ['abstract'],
        // No nativeType
      },
    ];

    const types = createSqlTypeMetadataRegistry([{ typeMetadata: extensionMetadata }]);
    const entries = Array.from(types.values());
    const abstractMetadata = entries.find((e) => e.typeId === 'pg/abstract@1');

    expect(abstractMetadata).toBeDefined();
    expect(abstractMetadata?.nativeType).toBeUndefined();
  });
});
