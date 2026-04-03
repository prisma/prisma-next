import type { TypesImportSpec } from '@prisma-next/framework-components/emission';
import { describe, expect, it } from 'vitest';
import {
  deduplicateImports,
  generateCodecTypeIntersection,
  generateHashTypeAliases,
  generateImportLines,
  generateModelRelationsType,
  generateRootsType,
  serializeObjectKey,
  serializeValue,
} from '../src/domain-type-generation';

describe('serializeValue', () => {
  it('serializes null', () => {
    expect(serializeValue(null)).toBe('null');
  });

  it('serializes undefined', () => {
    expect(serializeValue(undefined)).toBe('undefined');
  });

  it('serializes strings with single quotes', () => {
    expect(serializeValue('hello')).toBe("'hello'");
  });

  it('escapes backslashes and single quotes in strings', () => {
    expect(serializeValue("it's")).toBe("'it\\'s'");
    expect(serializeValue('back\\slash')).toBe("'back\\\\slash'");
  });

  it('serializes numbers', () => {
    expect(serializeValue(42)).toBe('42');
    expect(serializeValue(3.14)).toBe('3.14');
  });

  it('serializes booleans', () => {
    expect(serializeValue(true)).toBe('true');
    expect(serializeValue(false)).toBe('false');
  });

  it('serializes bigints', () => {
    expect(serializeValue(BigInt(123))).toBe('123n');
  });

  it('serializes arrays as readonly tuples', () => {
    expect(serializeValue(['a', 'b'])).toBe("readonly ['a', 'b']");
  });

  it('serializes objects with readonly properties', () => {
    expect(serializeValue({ key: 'val' })).toBe("{ readonly key: 'val' }");
  });

  it('serializes nested objects', () => {
    const result = serializeValue({ a: { b: 1 } });
    expect(result).toBe('{ readonly a: { readonly b: 1 } }');
  });

  it('returns unknown for unsupported types', () => {
    expect(serializeValue(Symbol('test'))).toBe('unknown');
  });
});

describe('serializeObjectKey', () => {
  it('passes through valid identifiers', () => {
    expect(serializeObjectKey('foo')).toBe('foo');
    expect(serializeObjectKey('_bar')).toBe('_bar');
    expect(serializeObjectKey('$baz')).toBe('$baz');
    expect(serializeObjectKey('camelCase')).toBe('camelCase');
  });

  it('quotes keys with special characters', () => {
    expect(serializeObjectKey('has space')).toBe("'has space'");
    expect(serializeObjectKey('has-dash')).toBe("'has-dash'");
    expect(serializeObjectKey('ns/name@1')).toBe("'ns/name@1'");
  });
});

describe('generateRootsType', () => {
  it('returns Record<string, string> for undefined roots', () => {
    expect(generateRootsType(undefined)).toBe('Record<string, string>');
  });

  it('returns Record<string, string> for empty roots', () => {
    expect(generateRootsType({})).toBe('Record<string, string>');
  });

  it('generates literal object type for roots', () => {
    const result = generateRootsType({ users: 'User', posts: 'Post' });
    expect(result).toContain("readonly users: 'User'");
    expect(result).toContain("readonly posts: 'Post'");
  });
});

describe('generateModelRelationsType', () => {
  it('returns empty object for empty relations', () => {
    expect(generateModelRelationsType({})).toBe('Record<string, never>');
  });

  it('generates relation with to and cardinality', () => {
    const result = generateModelRelationsType({
      posts: { to: 'Post', cardinality: '1:N' },
    });
    expect(result).toContain("readonly to: 'Post'");
    expect(result).toContain("readonly cardinality: '1:N'");
  });

  it('generates relation with on (localFields/targetFields)', () => {
    const result = generateModelRelationsType({
      author: {
        to: 'User',
        cardinality: 'N:1',
        on: { localFields: ['authorId'], targetFields: ['_id'] },
      },
    });
    expect(result).toContain("readonly to: 'User'");
    expect(result).toContain("readonly cardinality: 'N:1'");
    expect(result).toContain("readonly localFields: readonly ['authorId']");
    expect(result).toContain("readonly targetFields: readonly ['_id']");
  });

  it('skips non-object relations', () => {
    const result = generateModelRelationsType({
      bad: 'not an object' as unknown as Record<string, unknown>,
    });
    expect(result).toBe('Record<string, never>');
  });

  it('generates multiple relations', () => {
    const result = generateModelRelationsType({
      author: { to: 'User', cardinality: 'N:1' },
      comments: { to: 'Comment', cardinality: '1:N' },
    });
    expect(result).toContain('readonly author:');
    expect(result).toContain('readonly comments:');
  });

  it('omits to when missing from relation', () => {
    const result = generateModelRelationsType({
      rel: { cardinality: '1:N' },
    });
    expect(result).toContain("readonly cardinality: '1:N'");
    expect(result).not.toContain('readonly to:');
  });

  it('omits cardinality when missing from relation', () => {
    const result = generateModelRelationsType({
      rel: { to: 'Post' },
    });
    expect(result).toContain("readonly to: 'Post'");
    expect(result).not.toContain('readonly cardinality:');
  });

  it('skips relation object with no recognized properties', () => {
    const result = generateModelRelationsType({
      empty: { unknown: true },
    });
    expect(result).toBe('Record<string, never>');
  });

  it('throws when relation has on but missing localFields/targetFields', () => {
    expect(() =>
      generateModelRelationsType({
        author: {
          to: 'User',
          cardinality: 'N:1',
          on: { parentCols: ['userId'], childCols: ['id'] },
        },
      }),
    ).toThrow('missing localFields or targetFields');
  });
});

describe('deduplicateImports', () => {
  it('returns empty array for empty input', () => {
    expect(deduplicateImports([])).toEqual([]);
  });

  it('keeps unique imports', () => {
    const imports: TypesImportSpec[] = [
      { package: 'pkg-a', named: 'CodecTypes', alias: 'A' },
      { package: 'pkg-b', named: 'CodecTypes', alias: 'B' },
    ];
    expect(deduplicateImports(imports)).toHaveLength(2);
  });

  it('deduplicates by package+named (first wins)', () => {
    const imports: TypesImportSpec[] = [
      { package: 'pkg-a', named: 'CodecTypes', alias: 'First' },
      { package: 'pkg-a', named: 'CodecTypes', alias: 'Second' },
    ];
    const result = deduplicateImports(imports);
    expect(result).toHaveLength(1);
    expect(result[0]!.alias).toBe('First');
  });

  it('preserves insertion order', () => {
    const imports: TypesImportSpec[] = [
      { package: 'pkg-b', named: 'X', alias: 'X' },
      { package: 'pkg-a', named: 'Y', alias: 'Y' },
    ];
    const result = deduplicateImports(imports);
    expect(result[0]!.package).toBe('pkg-b');
    expect(result[1]!.package).toBe('pkg-a');
  });
});

describe('generateImportLines', () => {
  it('generates import with alias', () => {
    const imports: TypesImportSpec[] = [
      { package: '@prisma-next/adapter', named: 'CodecTypes', alias: 'PgCodecTypes' },
    ];
    const lines = generateImportLines(imports);
    expect(lines).toEqual([
      "import type { CodecTypes as PgCodecTypes } from '@prisma-next/adapter';",
    ]);
  });

  it('simplifies import when named === alias', () => {
    const imports: TypesImportSpec[] = [
      { package: '@prisma-next/adapter', named: 'Vector', alias: 'Vector' },
    ];
    const lines = generateImportLines(imports);
    expect(lines).toEqual(["import type { Vector } from '@prisma-next/adapter';"]);
  });
});

describe('generateCodecTypeIntersection', () => {
  it('returns Record<string, never> when no matching imports', () => {
    expect(generateCodecTypeIntersection([], 'CodecTypes')).toBe('Record<string, never>');
  });

  it('returns single alias when one match', () => {
    const imports: TypesImportSpec[] = [
      { package: 'pkg', named: 'CodecTypes', alias: 'PgCodecTypes' },
    ];
    expect(generateCodecTypeIntersection(imports, 'CodecTypes')).toBe('PgCodecTypes');
  });

  it('returns intersection when multiple matches', () => {
    const imports: TypesImportSpec[] = [
      { package: 'pkg-a', named: 'CodecTypes', alias: 'A' },
      { package: 'pkg-b', named: 'CodecTypes', alias: 'B' },
    ];
    expect(generateCodecTypeIntersection(imports, 'CodecTypes')).toBe('A & B');
  });

  it('filters by named parameter', () => {
    const imports: TypesImportSpec[] = [
      { package: 'pkg', named: 'CodecTypes', alias: 'CT' },
      { package: 'pkg', named: 'OperationTypes', alias: 'OT' },
    ];
    expect(generateCodecTypeIntersection(imports, 'OperationTypes')).toBe('OT');
  });
});

describe('generateHashTypeAliases', () => {
  it('generates storage and profile hash aliases', () => {
    const result = generateHashTypeAliases({
      storageHash: 'sha256:abc123',
      profileHash: 'sha256:def456',
    });
    expect(result).toContain("StorageHashBase<'sha256:abc123'>");
    expect(result).toContain("ProfileHashBase<'sha256:def456'>");
  });

  it('generates concrete execution hash when provided', () => {
    const result = generateHashTypeAliases({
      storageHash: 'sha256:abc',
      executionHash: 'sha256:exec',
      profileHash: 'sha256:prof',
    });
    expect(result).toContain("ExecutionHashBase<'sha256:exec'>");
  });

  it('generates generic execution hash when not provided', () => {
    const result = generateHashTypeAliases({
      storageHash: 'sha256:abc',
      profileHash: 'sha256:prof',
    });
    expect(result).toContain('ExecutionHashBase<string>');
  });
});
