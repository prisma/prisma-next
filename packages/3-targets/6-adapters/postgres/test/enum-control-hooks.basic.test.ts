import type { SqlControlDriverInstance } from '@prisma-next/sql-contract/types';
import { describe, expect, it } from 'vitest';
import { introspectPostgresEnumTypes, parsePostgresArray } from '../src/core/enum-control-hooks';
import { ENUM_CODEC_ID } from './test-utils';

describe('parsePostgresArray', () => {
  it('returns array as-is when input is already a string array', () => {
    expect(parsePostgresArray(['USER', 'ADMIN'])).toEqual(['USER', 'ADMIN']);
  });

  it('parses PostgreSQL array literal format', () => {
    expect(parsePostgresArray('{USER,ADMIN}')).toEqual(['USER', 'ADMIN']);
  });

  it('handles empty PostgreSQL array literal', () => {
    expect(parsePostgresArray('{}')).toEqual([]);
  });

  it('handles single value PostgreSQL array literal', () => {
    expect(parsePostgresArray('{USER}')).toEqual(['USER']);
  });

  it('trims whitespace from values', () => {
    expect(parsePostgresArray('{ USER , ADMIN }')).toEqual(['USER', 'ADMIN']);
  });

  it('returns null for non-array non-string values', () => {
    expect(parsePostgresArray(123)).toBeNull();
    expect(parsePostgresArray(null)).toBeNull();
    expect(parsePostgresArray(undefined)).toBeNull();
    expect(parsePostgresArray({ key: 'value' })).toBeNull();
  });

  it('returns null for strings not in array format', () => {
    expect(parsePostgresArray('USER')).toBeNull();
    expect(parsePostgresArray('USER,ADMIN')).toBeNull();
  });

  it('returns null for arrays containing non-strings', () => {
    expect(parsePostgresArray([1, 2, 3])).toBeNull();
    expect(parsePostgresArray(['USER', 123])).toBeNull();
  });

  it('handles quoted values containing commas', () => {
    expect(parsePostgresArray('{"has,comma",ADMIN}')).toEqual(['has,comma', 'ADMIN']);
  });

  it('handles quoted values with escaped double quotes', () => {
    expect(parsePostgresArray('{"say \\"hello\\"",ADMIN}')).toEqual(['say "hello"', 'ADMIN']);
  });

  it('handles quoted values with escaped backslashes', () => {
    expect(parsePostgresArray('{"path\\\\dir",ADMIN}')).toEqual(['path\\dir', 'ADMIN']);
  });

  it('handles mixed quoted and unquoted values', () => {
    expect(parsePostgresArray('{SIMPLE,"has,comma","with \\"quotes\\"",PLAIN}')).toEqual([
      'SIMPLE',
      'has,comma',
      'with "quotes"',
      'PLAIN',
    ]);
  });
});

describe('introspectPostgresEnumTypes', () => {
  function createMockDriver(
    rows: Array<{ schema_name: string; type_name: string; values: unknown }>,
  ): SqlControlDriverInstance<'postgres'> {
    return {
      familyId: 'sql',
      targetId: 'postgres',
      query: async <Row>() => ({ rows }) as { readonly rows: Row[] },
      close: async () => {},
    };
  }

  it('introspects enum storage types', async () => {
    const driver = createMockDriver([
      { schema_name: 'public', type_name: 'role', values: ['USER', 'ADMIN'] },
    ]);

    const types = await introspectPostgresEnumTypes({ driver, schemaName: 'public' });

    expect(types).toMatchObject({
      role: {
        codecId: ENUM_CODEC_ID,
        nativeType: 'role',
        typeParams: { values: ['USER', 'ADMIN'] },
      },
    });
  });

  it('introspects enum with PostgreSQL array string format', async () => {
    const driver = createMockDriver([
      { schema_name: 'public', type_name: 'status', values: '{PENDING,ACTIVE,CLOSED}' },
    ]);

    const types = await introspectPostgresEnumTypes({ driver, schemaName: 'public' });

    expect(types).toMatchObject({
      status: {
        codecId: ENUM_CODEC_ID,
        nativeType: 'status',
        typeParams: { values: ['PENDING', 'ACTIVE', 'CLOSED'] },
      },
    });
  });

  it('throws when enum values cannot be parsed', async () => {
    const driver = createMockDriver([
      { schema_name: 'public', type_name: 'invalid', values: [1, 2] },
    ]);

    await expect(introspectPostgresEnumTypes({ driver, schemaName: 'public' })).rejects.toThrow(
      'Failed to parse enum values for type "invalid"',
    );
  });

  it('throws with descriptive message showing the unexpected format', async () => {
    const driver = createMockDriver([
      { schema_name: 'public', type_name: 'broken', values: { nested: 'object' } },
    ]);

    await expect(introspectPostgresEnumTypes({ driver, schemaName: 'public' })).rejects.toThrow(
      'unexpected format: {"nested":"object"}',
    );
  });

  it('defaults schema name to public when undefined', async () => {
    const expectedRows = [{ schema_name: 'public', type_name: 'role', values: ['USER'] }];
    const driver: SqlControlDriverInstance<'postgres'> = {
      familyId: 'sql',
      targetId: 'postgres',
      query: async <Row>(_sql: string, params?: unknown[]) => {
        expect(params).toEqual(['public']);
        return { rows: expectedRows } as { readonly rows: Row[] };
      },
      close: async () => {},
    };
    const types = await introspectPostgresEnumTypes({ driver });
    expect(types['role']?.nativeType).toBe('role');
  });
});
