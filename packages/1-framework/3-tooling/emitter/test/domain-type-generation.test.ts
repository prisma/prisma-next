import type {
  ContractField,
  ContractModel,
  ContractValueObject,
} from '@prisma-next/contract/types';
import type { Codec, CodecLookup } from '@prisma-next/framework-components/codec';
import type { TypesImportSpec } from '@prisma-next/framework-components/emission';
import { describe, expect, it, vi } from 'vitest';
import {
  deduplicateImports,
  generateCodecTypeIntersection,
  generateContractFieldDescriptor,
  generateFieldOutputTypesMap,
  generateFieldResolvedType,
  generateHashTypeAliases,
  generateImportLines,
  generateModelFieldsType,
  generateModelRelationsType,
  generateModelsType,
  generateRootsType,
  generateValueObjectsDescriptorType,
  generateValueObjectType,
  generateValueObjectTypeAliases,
  serializeExecutionType,
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

describe('generateModelFieldsType', () => {
  it('returns Record<string, never> for empty fields', () => {
    expect(generateModelFieldsType({})).toBe('Record<string, never>');
  });

  it('generates field with type descriptor and nullable', () => {
    const result = generateModelFieldsType({
      name: { type: { kind: 'scalar', codecId: 'sql/text@1' }, nullable: false },
    });
    expect(result).toBe(
      "{ readonly name: { readonly nullable: false; readonly type: { readonly kind: 'scalar'; readonly codecId: 'sql/text@1' } } }",
    );
  });

  it('generates multiple fields', () => {
    const result = generateModelFieldsType({
      id: { type: { kind: 'scalar', codecId: 'sql/int4@1' }, nullable: false },
      email: { type: { kind: 'scalar', codecId: 'sql/text@1' }, nullable: true },
    });
    expect(result).toContain(
      "readonly id: { readonly nullable: false; readonly type: { readonly kind: 'scalar'; readonly codecId: 'sql/int4@1' } }",
    );
    expect(result).toContain(
      "readonly email: { readonly nullable: true; readonly type: { readonly kind: 'scalar'; readonly codecId: 'sql/text@1' } }",
    );
  });

  it('quotes keys with special characters', () => {
    const result = generateModelFieldsType({
      'field-name': { type: { kind: 'scalar', codecId: 'sql/text@1' }, nullable: false },
    });
    expect(result).toContain("readonly 'field-name':");
  });
});

describe('generateModelsType', () => {
  const noopStorage = () => 'Record<string, never>';

  function makeModel(overrides: Partial<ContractModel> = {}): ContractModel {
    return {
      fields: {},
      relations: {},
      storage: { storageHash: 'test' },
      ...overrides,
    };
  }

  it('returns Record<string, never> for empty models', () => {
    expect(generateModelsType({}, noopStorage)).toBe('Record<string, never>');
  });

  it('generates model with fields, relations, and storage', () => {
    const models: Record<string, ContractModel> = {
      User: makeModel({
        fields: { name: { type: { kind: 'scalar', codecId: 'sql/text@1' }, nullable: false } },
        relations: { posts: { to: 'Post', cardinality: '1:N' } },
      }),
    };
    const result = generateModelsType(models, () => "{ readonly table: 'users' }");
    expect(result).toContain('readonly User:');
    expect(result).toContain("readonly codecId: 'sql/text@1'");
    expect(result).toContain("readonly to: 'Post'");
    expect(result).toContain("readonly table: 'users'");
  });

  it('sorts models by name', () => {
    const models: Record<string, ContractModel> = {
      Zebra: makeModel(),
      Alpha: makeModel(),
    };
    const result = generateModelsType(models, noopStorage);
    const alphaIdx = result.indexOf('Alpha');
    const zebraIdx = result.indexOf('Zebra');
    expect(alphaIdx).toBeLessThan(zebraIdx);
  });

  it('passes modelName and model to the storage callback', () => {
    const model = makeModel();
    const models: Record<string, ContractModel> = { User: model };
    const storageFn = vi.fn(() => 'Record<string, never>');
    generateModelsType(models, storageFn);
    expect(storageFn).toHaveBeenCalledWith('User', model);
  });

  it('includes owner when present', () => {
    const models: Record<string, ContractModel> = {
      Comment: makeModel({ owner: 'Post' }),
    };
    const result = generateModelsType(models, noopStorage);
    expect(result).toContain("readonly owner: 'Post'");
  });

  it('includes discriminator when present', () => {
    const models: Record<string, ContractModel> = {
      Animal: makeModel({ discriminator: { field: 'type' } }),
    };
    const result = generateModelsType(models, noopStorage);
    expect(result).toContain("readonly discriminator: { readonly field: 'type' }");
  });

  it('includes variants when present', () => {
    const models: Record<string, ContractModel> = {
      Animal: makeModel({ variants: { Dog: { value: 'dog' }, Cat: { value: 'cat' } } }),
    };
    const result = generateModelsType(models, noopStorage);
    expect(result).toContain('readonly variants:');
    expect(result).toContain('readonly Dog:');
    expect(result).toContain('readonly Cat:');
  });

  it('includes base when present', () => {
    const models: Record<string, ContractModel> = {
      Dog: makeModel({ base: 'Animal' }),
    };
    const result = generateModelsType(models, noopStorage);
    expect(result).toContain("readonly base: 'Animal'");
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

describe('serializeExecutionType', () => {
  it('uses ExecutionHash alias instead of literal hash value', () => {
    const result = serializeExecutionType({
      executionHash: 'sha256:abc123',
      mutations: { defaults: [] },
    });
    expect(result).toContain('readonly executionHash: ExecutionHash');
    expect(result).not.toContain('sha256:abc123');
  });

  it('serializes non-hash fields normally', () => {
    const result = serializeExecutionType({
      executionHash: 'sha256:abc123',
      mutations: { defaults: [{ kind: 'autoIncrement' }] },
    });
    expect(result).toContain('readonly mutations:');
    expect(result).toContain("readonly kind: 'autoIncrement'");
  });
});

describe('generateFieldResolvedType', () => {
  it('generates CodecTypes lookup for scalar fields', () => {
    const field: ContractField = {
      nullable: false,
      type: { kind: 'scalar', codecId: 'mongo/string@1' },
    };
    expect(generateFieldResolvedType(field)).toBe("CodecTypes['mongo/string@1']['output']");
  });

  it('generates named type reference for value object fields', () => {
    const field: ContractField = {
      nullable: false,
      type: { kind: 'valueObject', name: 'Address' },
    };
    expect(generateFieldResolvedType(field)).toBe('Address');
  });

  it('wraps in ReadonlyArray for many: true', () => {
    const field: ContractField = {
      nullable: false,
      type: { kind: 'valueObject', name: 'Address' },
      many: true,
    };
    expect(generateFieldResolvedType(field)).toBe('ReadonlyArray<Address>');
  });

  it('wraps in Readonly<Record> for dict: true', () => {
    const field: ContractField = {
      nullable: false,
      type: { kind: 'scalar', codecId: 'mongo/string@1' },
      dict: true,
    };
    expect(generateFieldResolvedType(field)).toBe(
      "Readonly<Record<string, CodecTypes['mongo/string@1']['output']>>",
    );
  });

  it('appends | null for nullable: true', () => {
    const field: ContractField = {
      nullable: true,
      type: { kind: 'valueObject', name: 'Address' },
    };
    expect(generateFieldResolvedType(field)).toBe('Address | null');
  });

  it('combines many and nullable', () => {
    const field: ContractField = {
      nullable: true,
      type: { kind: 'valueObject', name: 'Address' },
      many: true,
    };
    expect(generateFieldResolvedType(field)).toBe('ReadonlyArray<Address> | null');
  });

  it('handles union types', () => {
    const field: ContractField = {
      nullable: false,
      type: {
        kind: 'union',
        members: [
          { kind: 'scalar', codecId: 'mongo/string@1' },
          { kind: 'valueObject', name: 'Address' },
        ],
      },
    };
    expect(generateFieldResolvedType(field)).toBe(
      "CodecTypes['mongo/string@1']['output'] | Address",
    );
  });
});

describe('generateValueObjectType', () => {
  const addressVo: ContractValueObject = {
    fields: {
      street: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/string@1' } },
      city: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/string@1' } },
      zip: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/string@1' } },
    },
  };
  const valueObjects: Record<string, ContractValueObject> = { Address: addressVo };

  it('generates object type with all fields', () => {
    const result = generateValueObjectType('Address', addressVo, valueObjects);
    expect(result).toContain("readonly street: CodecTypes['mongo/string@1']['output']");
    expect(result).toContain("readonly city: CodecTypes['mongo/string@1']['output']");
    expect(result).toContain("readonly zip: CodecTypes['mongo/string@1']['output']");
  });

  it('handles value object field referencing another value object', () => {
    const companyVo: ContractValueObject = {
      fields: {
        name: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/string@1' } },
        address: { nullable: false, type: { kind: 'valueObject', name: 'Address' } },
      },
    };
    const vos = { ...valueObjects, Company: companyVo };
    const result = generateValueObjectType('Company', companyVo, vos);
    expect(result).toContain('readonly address: Address');
  });

  it('handles self-referencing value object (no infinite recursion)', () => {
    const navItemVo: ContractValueObject = {
      fields: {
        label: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/string@1' } },
        children: {
          nullable: false,
          type: { kind: 'valueObject', name: 'NavItem' },
          many: true,
        },
      },
    };
    const vos = { NavItem: navItemVo };
    const result = generateValueObjectType('NavItem', navItemVo, vos);
    expect(result).toContain('readonly children: ReadonlyArray<NavItem>');
  });

  it('returns Record<string, never> for empty value object', () => {
    const emptyVo: ContractValueObject = { fields: {} };
    expect(generateValueObjectType('Empty', emptyVo, {})).toBe('Record<string, never>');
  });
});

describe('generateContractFieldDescriptor', () => {
  it('generates scalar field descriptor', () => {
    const field: ContractField = {
      nullable: false,
      type: { kind: 'scalar', codecId: 'pg/text@1' },
    };
    const result = generateContractFieldDescriptor('name', field);
    expect(result).toBe(
      "readonly name: { readonly nullable: false; readonly type: { readonly kind: 'scalar'; readonly codecId: 'pg/text@1' } }",
    );
  });

  it('generates value object field descriptor', () => {
    const field: ContractField = {
      nullable: true,
      type: { kind: 'valueObject', name: 'Address' },
    };
    const result = generateContractFieldDescriptor('homeAddress', field);
    expect(result).toBe(
      "readonly homeAddress: { readonly nullable: true; readonly type: { readonly kind: 'valueObject'; readonly name: 'Address' } }",
    );
  });

  it('includes many modifier', () => {
    const field: ContractField = {
      nullable: false,
      type: { kind: 'valueObject', name: 'Address' },
      many: true,
    };
    const result = generateContractFieldDescriptor('addresses', field);
    expect(result).toContain('; readonly many: true');
  });

  it('includes dict modifier', () => {
    const field: ContractField = {
      nullable: false,
      type: { kind: 'scalar', codecId: 'mongo/string@1' },
      dict: true,
    };
    const result = generateContractFieldDescriptor('labels', field);
    expect(result).toContain('; readonly dict: true');
  });

  it('includes typeParams for scalar fields', () => {
    const field: ContractField = {
      nullable: false,
      type: { kind: 'scalar', codecId: 'pg/vector@1', typeParams: { length: 1536 } },
    };
    const result = generateContractFieldDescriptor('embedding', field);
    expect(result).toContain('readonly typeParams: { readonly length: 1536 }');
  });
});

describe('generateValueObjectsDescriptorType', () => {
  it('returns Record<string, never> for undefined', () => {
    expect(generateValueObjectsDescriptorType(undefined)).toBe('Record<string, never>');
  });

  it('returns Record<string, never> for empty', () => {
    expect(generateValueObjectsDescriptorType({})).toBe('Record<string, never>');
  });

  it('generates descriptor with fields for each value object', () => {
    const valueObjects: Record<string, ContractValueObject> = {
      Address: {
        fields: {
          street: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/string@1' } },
        },
      },
    };
    const result = generateValueObjectsDescriptorType(valueObjects);
    expect(result).toContain('readonly Address: { readonly fields:');
    expect(result).toContain("readonly kind: 'scalar'");
    expect(result).toContain("readonly codecId: 'mongo/string@1'");
  });
});

describe('generateValueObjectTypeAliases', () => {
  it('returns empty string for undefined', () => {
    expect(generateValueObjectTypeAliases(undefined)).toBe('');
  });

  it('returns empty string for empty', () => {
    expect(generateValueObjectTypeAliases({})).toBe('');
  });

  it('generates export type alias for each value object', () => {
    const valueObjects: Record<string, ContractValueObject> = {
      Address: {
        fields: {
          street: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/string@1' } },
        },
      },
    };
    const result = generateValueObjectTypeAliases(valueObjects);
    expect(result).toContain('export type Address =');
    expect(result).toContain("readonly street: CodecTypes['mongo/string@1']['output']");
  });

  it('generates multiple type aliases', () => {
    const valueObjects: Record<string, ContractValueObject> = {
      Address: {
        fields: {
          street: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/string@1' } },
        },
      },
      GeoPoint: {
        fields: {
          lat: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/double@1' } },
          lng: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/double@1' } },
        },
      },
    };
    const result = generateValueObjectTypeAliases(valueObjects);
    expect(result).toContain('export type Address =');
    expect(result).toContain('export type GeoPoint =');
  });
});

function stubCodec(overrides: Partial<Codec> & { id: string }): Codec {
  return {
    targetTypes: [],
    decode: (w: unknown) => w,
    encodeJson: (v: unknown) => v,
    decodeJson: (j: unknown) => j,
    ...overrides,
  } as unknown as Codec;
}

function stubCodecLookup(codecs: Record<string, Codec>): CodecLookup {
  return { get: (id) => codecs[id] };
}

describe('generateFieldResolvedType', () => {
  it('uses codec renderOutputType when typeParams are present', () => {
    const lookup = stubCodecLookup({
      'pg/char@1': stubCodec({
        id: 'pg/char@1',
        renderOutputType: (p) => `Char<${p['length']}>`,
      }),
    });
    const field: ContractField = {
      nullable: false,
      type: { kind: 'scalar', codecId: 'pg/char@1', typeParams: { length: 36 } },
    };
    expect(generateFieldResolvedType(field, lookup)).toBe('Char<36>');
  });

  it('falls back to CodecTypes lookup when no codecLookup provided', () => {
    const field: ContractField = {
      nullable: false,
      type: { kind: 'scalar', codecId: 'pg/int4@1' },
    };
    expect(generateFieldResolvedType(field)).toBe("CodecTypes['pg/int4@1']['output']");
  });

  it('falls back to CodecTypes when renderOutputType returns unsafe expression', () => {
    const lookup = stubCodecLookup({
      'test@1': stubCodec({
        id: 'test@1',
        renderOutputType: () => 'import("fs")',
      }),
    });
    const field: ContractField = {
      nullable: false,
      type: { kind: 'scalar', codecId: 'test@1', typeParams: { x: 1 } },
    };
    expect(generateFieldResolvedType(field, lookup)).toBe("CodecTypes['test@1']['output']");
  });

  it('falls back to CodecTypes when codec has no renderOutputType', () => {
    const lookup = stubCodecLookup({
      'pg/int4@1': stubCodec({ id: 'pg/int4@1' }),
    });
    const field: ContractField = {
      nullable: false,
      type: { kind: 'scalar', codecId: 'pg/int4@1', typeParams: { x: 1 } },
    };
    expect(generateFieldResolvedType(field, lookup)).toBe("CodecTypes['pg/int4@1']['output']");
  });

  it('falls back to CodecTypes when typeParams is empty', () => {
    const lookup = stubCodecLookup({
      'pg/char@1': stubCodec({
        id: 'pg/char@1',
        renderOutputType: () => 'Char<36>',
      }),
    });
    const field: ContractField = {
      nullable: false,
      type: { kind: 'scalar', codecId: 'pg/char@1', typeParams: {} },
    };
    expect(generateFieldResolvedType(field, lookup)).toBe("CodecTypes['pg/char@1']['output']");
  });
});

describe('generateFieldOutputTypesMap', () => {
  it('generates map entries with codec-dispatched rendering', () => {
    const lookup = stubCodecLookup({
      'pg/char@1': stubCodec({
        id: 'pg/char@1',
        renderOutputType: (p) => `Char<${p['length']}>`,
      }),
    });
    const models: Record<string, ContractModel> = {
      User: {
        fields: {
          id: {
            nullable: false,
            type: { kind: 'scalar', codecId: 'pg/char@1', typeParams: { length: 36 } },
          },
          name: {
            nullable: false,
            type: { kind: 'scalar', codecId: 'pg/text@1' },
          },
        },
        relations: {},
        storage: { fields: {}, table: 'user' },
      },
    };
    const result = generateFieldOutputTypesMap(models, lookup);
    expect(result).toContain('Char<36>');
    expect(result).toContain("CodecTypes['pg/text@1']['output']");
  });

  it('returns Record<string, never> for empty models', () => {
    expect(generateFieldOutputTypesMap(undefined)).toBe('Record<string, never>');
    expect(generateFieldOutputTypesMap({})).toBe('Record<string, never>');
  });
});
