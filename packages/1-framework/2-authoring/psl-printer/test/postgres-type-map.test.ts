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
    expect(typeMap.resolve('uuid')).toEqual({
      pslType: 'String',
      nativeType: 'uuid',
      nativeTypeAttribute: { name: 'db.Uuid' },
    });
  });

  it('maps alias types', () => {
    expect(typeMap.resolve('integer')).toEqual({ pslType: 'Int', nativeType: 'integer' });
    expect(typeMap.resolve('boolean')).toEqual({ pslType: 'Boolean', nativeType: 'boolean' });
    expect(typeMap.resolve('bigint')).toEqual({ pslType: 'BigInt', nativeType: 'bigint' });
    expect(typeMap.resolve('real')).toEqual({
      pslType: 'Float',
      nativeType: 'real',
      nativeTypeAttribute: { name: 'db.Real' },
    });
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
      nativeTypeAttribute: { name: 'db.VarChar', args: ['255'] },
    });
  });

  it('handles character type with parameter', () => {
    const result = typeMap.resolve('character(20)');
    expect(result).toEqual({
      pslType: 'String',
      nativeType: 'character(20)',
      typeParams: { baseType: 'character', params: '20' },
      nativeTypeAttribute: { name: 'db.Char', args: ['20'] },
    });
  });

  it('preserves bare varchar via a native type attribute', () => {
    expect(typeMap.resolve('varchar')).toEqual({
      pslType: 'String',
      nativeType: 'varchar',
      nativeTypeAttribute: { name: 'db.VarChar' },
    });
  });

  it('preserves non-default timestamp, date, time, json, and integer types', () => {
    expect(typeMap.resolve('timestamp')).toEqual({
      pslType: 'DateTime',
      nativeType: 'timestamp',
      nativeTypeAttribute: { name: 'db.Timestamp' },
    });
    expect(typeMap.resolve('time(3)')).toEqual({
      pslType: 'DateTime',
      nativeType: 'time(3)',
      typeParams: { baseType: 'time', params: '3' },
      nativeTypeAttribute: { name: 'db.Time', args: ['3'] },
    });
    expect(typeMap.resolve('date')).toEqual({
      pslType: 'DateTime',
      nativeType: 'date',
      nativeTypeAttribute: { name: 'db.Date' },
    });
    expect(typeMap.resolve('json')).toEqual({
      pslType: 'Json',
      nativeType: 'json',
      nativeTypeAttribute: { name: 'db.Json' },
    });
    expect(typeMap.resolve('int2')).toEqual({
      pslType: 'Int',
      nativeType: 'int2',
      nativeTypeAttribute: { name: 'db.SmallInt' },
    });
  });

  it('returns unsupported for unknown types', () => {
    expect(typeMap.resolve('geometry')).toEqual({ unsupported: true, nativeType: 'geometry' });
    expect(typeMap.resolve('hstore')).toEqual({ unsupported: true, nativeType: 'hstore' });
  });

  it('ignores prototype-chain property names', () => {
    expect(typeMap.resolve('constructor')).toEqual({
      unsupported: true,
      nativeType: 'constructor',
    });
    expect(typeMap.resolve('constructor(1)')).toEqual({
      unsupported: true,
      nativeType: 'constructor(1)',
    });
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

  it('ignores non-enum storage types while keeping enum codec entries', () => {
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
            typeParams: { values: 'ACTIVE' },
          },
          metadata: {
            codecId: 'pg/json@1',
            nativeType: 'jsonb',
            typeParams: {},
          },
        },
      },
    };

    expect(extractEnumTypeNames(annotations)).toEqual(new Set(['user_role', 'status']));
    expect(extractEnumDefinitions(annotations)).toEqual(
      new Map([['user_role', ['USER', 'ADMIN']]]),
    );
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
