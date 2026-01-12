import { describe, expect, it } from 'vitest';
import { codecDefinitions } from '../src/core/codecs';
import { postgresAdapterDescriptorMeta } from '../src/core/descriptor-meta';
import { enumColumn } from '../src/exports/column-types';

describe('enum codec', () => {
  it('registers pg/enum@1 codec', () => {
    expect(codecDefinitions['enum']).toBeDefined();
    expect(codecDefinitions['enum']?.codec.id).toBe('pg/enum@1');
  });

  it('encodes string values unchanged', () => {
    const codec = codecDefinitions['enum']?.codec;
    expect(codec).toBeDefined();
    const encode = codec?.encode;
    expect(encode).toBeDefined();
    if (encode) {
      expect(encode('ADMIN')).toBe('ADMIN');
      expect(encode('USER')).toBe('USER');
    }
  });

  it('decodes string values unchanged', () => {
    const codec = codecDefinitions['enum']?.codec;
    expect(codec).toBeDefined();
    const decode = codec?.decode;
    expect(decode).toBeDefined();
    if (decode) {
      expect(decode('ADMIN')).toBe('ADMIN');
      expect(decode('USER')).toBe('USER');
    }
  });

  it('has correct meta for enum codec', () => {
    const codec = codecDefinitions['enum']?.codec;
    expect(codec?.meta?.db?.sql?.postgres?.nativeType).toBe('enum');
  });
});

describe('enumColumn factory', () => {
  it('creates a column descriptor with typeParams.values', () => {
    const column = enumColumn('Role', ['USER', 'ADMIN', 'MODERATOR'] as const);

    expect(column.codecId).toBe('pg/enum@1');
    expect(column.nativeType).toBe('Role');
    expect(column.typeParams).toEqual({ values: ['USER', 'ADMIN', 'MODERATOR'] });
  });

  it('preserves literal types in the return type', () => {
    const column = enumColumn('Status', ['PENDING', 'ACTIVE'] as const);

    // TypeScript should infer: { nativeType: 'Status', typeParams: { values: readonly ['PENDING', 'ACTIVE'] } }
    expect(column.nativeType).toBe('Status');
    expect(column.typeParams.values).toEqual(['PENDING', 'ACTIVE']);
  });
});

describe('enum type renderer', () => {
  const renderEnumType = postgresAdapterDescriptorMeta.types.codecTypes.parameterized['pg/enum@1'];

  it('renders simple enum values as union type', () => {
    const result = renderEnumType({ values: ['USER', 'ADMIN'] });
    expect(result).toBe('"USER" | "ADMIN"');
  });

  it('returns string for empty values array', () => {
    const result = renderEnumType({ values: [] });
    expect(result).toBe('string');
  });

  it('returns string for missing values', () => {
    const result = renderEnumType({});
    expect(result).toBe('string');
  });

  it('returns string for non-array values', () => {
    const result = renderEnumType({ values: 'not-an-array' });
    expect(result).toBe('string');
  });

  it('escapes single quotes in enum values', () => {
    const result = renderEnumType({ values: ["USER'S", 'ADMIN'] });
    // JSON.stringify produces escaped output
    expect(result).toBe('"USER\'S" | "ADMIN"');
    // Verify it's valid TypeScript by checking no unescaped quotes
    expect(result).not.toContain("'S'");
  });

  it('escapes double quotes in enum values', () => {
    const result = renderEnumType({ values: ['WITH"QUOTE', 'NORMAL'] });
    // JSON.stringify escapes double quotes
    expect(result).toBe('"WITH\\"QUOTE" | "NORMAL"');
  });

  it('escapes backslashes in enum values', () => {
    const result = renderEnumType({ values: ['PATH\\VALUE', 'NORMAL'] });
    // JSON.stringify escapes backslashes
    expect(result).toBe('"PATH\\\\VALUE" | "NORMAL"');
  });

  it('handles unicode characters in enum values', () => {
    const result = renderEnumType({ values: ['CAFÉ', '日本語'] });
    expect(result).toBe('"CAFÉ" | "日本語"');
  });

  it('converts non-string values to strings', () => {
    const result = renderEnumType({ values: [123, true, null] });
    expect(result).toBe('"123" | "true" | "null"');
  });
});
