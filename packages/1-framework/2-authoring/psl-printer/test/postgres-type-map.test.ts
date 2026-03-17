import { describe, expect, it } from 'vitest';
import {
  createPostgresTypeMap,
  extractEnumDefinitions,
  extractEnumTypeNames,
} from '../src/postgres-type-map';

describe('createPostgresTypeMap', () => {
  const typeMap = createPostgresTypeMap();

  it('maps basic scalar types', () => {
    expect(typeMap.resolve('text')).toEqual({ pslType: 'String', nativeType: 'text' });
    expect(typeMap.resolve('int4')).toEqual({ pslType: 'Int', nativeType: 'int4' });
    expect(typeMap.resolve('bool')).toEqual({ pslType: 'Boolean', nativeType: 'bool' });
    expect(typeMap.resolve('float8')).toEqual({ pslType: 'Float', nativeType: 'float8' });
    expect(typeMap.resolve('numeric')).toEqual({ pslType: 'Decimal', nativeType: 'numeric' });
    expect(typeMap.resolve('timestamptz')).toEqual({
      pslType: 'DateTime',
      nativeType: 'timestamptz',
    });
    expect(typeMap.resolve('jsonb')).toEqual({ pslType: 'Json', nativeType: 'jsonb' });
    expect(typeMap.resolve('bytea')).toEqual({ pslType: 'Bytes', nativeType: 'bytea' });
    expect(typeMap.resolve('int8')).toEqual({ pslType: 'BigInt', nativeType: 'int8' });
    expect(typeMap.resolve('uuid')).toEqual({ pslType: 'String', nativeType: 'uuid' });
  });

  it('maps alias types', () => {
    expect(typeMap.resolve('integer')).toEqual({ pslType: 'Int', nativeType: 'integer' });
    expect(typeMap.resolve('boolean')).toEqual({ pslType: 'Boolean', nativeType: 'boolean' });
    expect(typeMap.resolve('bigint')).toEqual({ pslType: 'BigInt', nativeType: 'bigint' });
    expect(typeMap.resolve('real')).toEqual({ pslType: 'Float', nativeType: 'real' });
    expect(typeMap.resolve('double precision')).toEqual({
      pslType: 'Float',
      nativeType: 'double precision',
    });
  });

  it('handles parameterized types', () => {
    const result = typeMap.resolve('character varying(255)');
    expect(result).toEqual({
      pslType: 'String',
      nativeType: 'character varying(255)',
      typeParams: { baseType: 'character varying', params: '255' },
    });
  });

  it('handles character type with parameter', () => {
    const result = typeMap.resolve('character(20)');
    expect(result).toEqual({
      pslType: 'String',
      nativeType: 'character(20)',
      typeParams: { baseType: 'character', params: '20' },
    });
  });

  it('returns unsupported for unknown types', () => {
    expect(typeMap.resolve('geometry')).toEqual({ unsupported: true, nativeType: 'geometry' });
    expect(typeMap.resolve('hstore')).toEqual({ unsupported: true, nativeType: 'hstore' });
  });

  it('detects enum types when provided', () => {
    const enumTypes = new Set(['user_role', 'status']);
    const enumTypeMap = createPostgresTypeMap(enumTypes);

    expect(enumTypeMap.resolve('user_role')).toEqual({
      pslType: 'user_role',
      nativeType: 'user_role',
    });
    expect(enumTypeMap.resolve('status')).toEqual({ pslType: 'status', nativeType: 'status' });
    // Non-enum still resolves normally
    expect(enumTypeMap.resolve('text')).toEqual({ pslType: 'String', nativeType: 'text' });
  });
});

describe('extractEnumTypeNames', () => {
  it('extracts enum type names from annotations', () => {
    const annotations = {
      pg: {
        storageTypes: {
          user_role: {
            codecId: 'pg/enum@1',
            nativeType: 'user_role',
            typeParams: { values: ['USER', 'ADMIN'] },
          },
          status: {
            codecId: 'pg/enum@1',
            nativeType: 'status',
            typeParams: { values: ['ACTIVE', 'INACTIVE'] },
          },
        },
      },
    };
    const result = extractEnumTypeNames(annotations);
    expect(result).toEqual(new Set(['user_role', 'status']));
  });

  it('returns empty set for no annotations', () => {
    expect(extractEnumTypeNames(undefined)).toEqual(new Set());
    expect(extractEnumTypeNames({})).toEqual(new Set());
  });
});

describe('extractEnumDefinitions', () => {
  it('extracts enum definitions', () => {
    const annotations = {
      pg: {
        storageTypes: {
          user_role: {
            codecId: 'pg/enum@1',
            nativeType: 'user_role',
            typeParams: { values: ['USER', 'ADMIN'] },
          },
        },
      },
    };
    const result = extractEnumDefinitions(annotations);
    expect(result.get('user_role')).toEqual(['USER', 'ADMIN']);
  });
});
