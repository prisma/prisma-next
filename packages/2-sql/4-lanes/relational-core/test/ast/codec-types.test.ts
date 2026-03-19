import type { Type } from 'arktype';
import { describe, expect, it } from 'vitest';
import { codec, createCodecRegistry, defineCodecs } from '../../src/ast/codec-types';

describe('codec factory', () => {
  it('creates codec with id, targetTypes, encode, and decode', () => {
    const testCodec = codec({
      typeId: 'test/type@1',
      targetTypes: ['text'],
      encode: (value: string) => value.toUpperCase(),
      decode: (wire: string) => wire.toLowerCase(),
    });

    expect({
      id: testCodec.id,
      targetTypes: testCodec.targetTypes,
      hasEncode: testCodec.encode !== undefined,
      hasDecode: testCodec.decode !== undefined,
      encodeResult: testCodec.encode!('hello'),
      decodeResult: testCodec.decode('WORLD'),
    }).toMatchObject({
      id: 'test/type@1',
      targetTypes: ['text'],
      hasEncode: true,
      hasDecode: true,
      encodeResult: 'HELLO',
      decodeResult: 'world',
    });
  });

  it('creates codec with multiple target types', () => {
    const testCodec = codec({
      typeId: 'test/multi@1',
      targetTypes: ['int4', 'int8'],
      encode: (value: number) => value.toString(),
      decode: (wire: string) => Number.parseInt(wire, 10),
    });

    expect(testCodec.targetTypes).toEqual(['int4', 'int8']);
  });

  it('creates codec with meta property', () => {
    const testCodec = codec({
      typeId: 'test/with-meta@1',
      targetTypes: ['text'],
      encode: (value: string) => value,
      decode: (wire: string) => wire,
      meta: { db: { sql: { postgres: { nativeType: 'text' } } } },
    });

    expect(testCodec.meta).toEqual({ db: { sql: { postgres: { nativeType: 'text' } } } });
  });

  it.each([
    {
      label: 'without meta',
      config: {},
      check: (testCodec: unknown) => {
        expect((testCodec as { readonly meta?: unknown }).meta).toBeUndefined();
      },
    },
    {
      label: 'with paramsSchema',
      config: {
        paramsSchema: {} as unknown as Type<{ readonly precision: number }>,
      },
      check: (testCodec: unknown) => {
        expect((testCodec as { readonly paramsSchema?: unknown }).paramsSchema).toBeDefined();
      },
    },
    {
      label: 'with init',
      config: {
        init: (params: { precision: number }) => ({ normalized: params.precision }),
      },
      check: (testCodec: unknown) => {
        const codecWithInit = testCodec as {
          readonly init?: (params: { readonly precision: number }) => {
            readonly normalized: number;
          };
        };
        expect(codecWithInit.init).toBeDefined();
        expect(codecWithInit.init?.({ precision: 12 })).toEqual({ normalized: 12 });
      },
    },
  ])('creates codec $label', ({ config, check }) => {
    const testCodec = codec({
      typeId: 'test/optional@1',
      targetTypes: ['text'],
      encode: (value: string) => value,
      decode: (wire: string) => wire,
      ...config,
    });

    check(testCodec);
  });
});

describe('CodecRegistry', () => {
  it('returns undefined for unregistered codec', () => {
    const registry = createCodecRegistry();
    expect(registry.get('unknown/id@1')).toBeUndefined();
  });

  it('returns false for unregistered codec has check', () => {
    const registry = createCodecRegistry();
    expect(registry.has('unknown/id@1')).toBe(false);
  });

  it('registers and retrieves codec by id', () => {
    const registry = createCodecRegistry();
    const testCodec = codec({
      typeId: 'test/type@1',
      targetTypes: ['text'],
      encode: (value: string) => value,
      decode: (wire: string) => wire,
    });

    registry.register(testCodec);
    expect({
      has: registry.has('test/type@1'),
      get: registry.get('test/type@1'),
    }).toMatchObject({
      has: true,
      get: testCodec,
    });
  });

  it('throws error when registering duplicate codec id', () => {
    const registry = createCodecRegistry();
    const codec1 = codec({
      typeId: 'test/type@1',
      targetTypes: ['text'],
      encode: (value: string) => value,
      decode: (wire: string) => wire,
    });

    const codec2 = codec({
      typeId: 'test/type@1',
      targetTypes: ['text'],
      encode: (value: string) => value,
      decode: (wire: string) => wire,
    });

    registry.register(codec1);
    expect(() => {
      registry.register(codec2);
    }).toThrow("Codec with ID 'test/type@1' is already registered");
  });

  it('returns empty array for unknown scalar type', () => {
    const registry = createCodecRegistry();
    const result = registry.getByScalar('unknown');
    expect(result).toEqual([]);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('returns codecs by scalar type', () => {
    const registry = createCodecRegistry();
    const codec1 = codec({
      typeId: 'test/type1@1',
      targetTypes: ['text'],
      encode: (value: string) => value,
      decode: (wire: string) => wire,
    });

    const codec2 = codec({
      typeId: 'test/type2@1',
      targetTypes: ['text'],
      encode: (value: string) => value,
      decode: (wire: string) => wire,
    });

    registry.register(codec1);
    registry.register(codec2);

    const codecs = registry.getByScalar('text');
    expect({
      length: codecs.length,
      containsCodec1: codecs.includes(codec1),
      containsCodec2: codecs.includes(codec2),
    }).toMatchObject({
      length: 2,
      containsCodec1: true,
      containsCodec2: true,
    });
  });

  it('returns undefined for default codec when no codecs exist', () => {
    const registry = createCodecRegistry();
    expect(registry.getDefaultCodec('unknown')).toBeUndefined();
  });

  it('returns first codec as default for scalar type', () => {
    const registry = createCodecRegistry();
    const codec1 = codec({
      typeId: 'test/type1@1',
      targetTypes: ['text'],
      encode: (value: string) => value,
      decode: (wire: string) => wire,
    });

    const codec2 = codec({
      typeId: 'test/type2@1',
      targetTypes: ['text'],
      encode: (value: string) => value,
      decode: (wire: string) => wire,
    });

    registry.register(codec1);
    registry.register(codec2);

    expect(registry.getDefaultCodec('text')).toBe(codec1);
  });

  it('handles codec with multiple target types', () => {
    const registry = createCodecRegistry();
    const multiCodec = codec({
      typeId: 'test/multi@1',
      targetTypes: ['int4', 'int8'],
      encode: (value: number) => value,
      decode: (wire: number) => wire,
    });

    registry.register(multiCodec);

    expect({
      int4Contains: registry.getByScalar('int4').includes(multiCodec),
      int8Contains: registry.getByScalar('int8').includes(multiCodec),
      int4Default: registry.getDefaultCodec('int4'),
      int8Default: registry.getDefaultCodec('int8'),
    }).toMatchObject({
      int4Contains: true,
      int8Contains: true,
      int4Default: multiCodec,
      int8Default: multiCodec,
    });
  });

  it('iterates over all registered codecs', () => {
    const registry = createCodecRegistry();
    const codec1 = codec({
      typeId: 'test/type1@1',
      targetTypes: ['text'],
      encode: (value: string) => value,
      decode: (wire: string) => wire,
    });

    const codec2 = codec({
      typeId: 'test/type2@1',
      targetTypes: ['int4'],
      encode: (value: number) => value,
      decode: (wire: number) => wire,
    });

    registry.register(codec1);
    registry.register(codec2);

    const codecs = Array.from(registry);
    expect({
      length: codecs.length,
      containsCodec1: codecs.includes(codec1),
      containsCodec2: codecs.includes(codec2),
    }).toMatchObject({
      length: 2,
      containsCodec1: true,
      containsCodec2: true,
    });
  });

  it('returns values iterator', () => {
    const registry = createCodecRegistry();
    const codec1 = codec({
      typeId: 'test/type1@1',
      targetTypes: ['text'],
      encode: (value: string) => value,
      decode: (wire: string) => wire,
    });

    const codec2 = codec({
      typeId: 'test/type2@1',
      targetTypes: ['int4'],
      encode: (value: number) => value,
      decode: (wire: number) => wire,
    });

    registry.register(codec1);
    registry.register(codec2);

    const codecs = Array.from(registry.values());
    expect({
      length: codecs.length,
      containsCodec1: codecs.includes(codec1),
      containsCodec2: codecs.includes(codec2),
    }).toMatchObject({
      length: 2,
      containsCodec1: true,
      containsCodec2: true,
    });
  });

  it('handles codec registration with existing scalar type array', () => {
    const registry = createCodecRegistry();
    const codec1 = codec({
      typeId: 'test/type1@1',
      targetTypes: ['text'],
      encode: (value: string) => value,
      decode: (wire: string) => wire,
    });

    const codec2 = codec({
      typeId: 'test/type2@1',
      targetTypes: ['text'],
      encode: (value: string) => value,
      decode: (wire: string) => wire,
    });

    registry.register(codec1);
    registry.register(codec2);

    const codecs = registry.getByScalar('text');
    expect({
      length: codecs.length,
      first: codecs[0],
      second: codecs[1],
    }).toMatchObject({
      length: 2,
      first: codec1,
      second: codec2,
    });
  });
});

describe('CodecDefBuilder', () => {
  it('creates empty builder', () => {
    const builder = defineCodecs();
    expect({
      codecTypes: builder.CodecTypes,
      dataTypes: builder.dataTypes,
      codecDefinitions: builder.codecDefinitions,
    }).toMatchObject({
      codecTypes: {},
      dataTypes: {},
      codecDefinitions: {},
    });
  });

  it('adds codec to builder', () => {
    const codec1 = codec({
      typeId: 'test/type1@1',
      targetTypes: ['text'],
      encode: (value: string) => value,
      decode: (wire: string) => wire,
    });

    const builder = defineCodecs().add('text', codec1);
    expect({
      hasCodecTypes: builder.CodecTypes !== undefined,
      hasDataTypes: builder.dataTypes !== undefined,
      hasCodecDefinitions: builder.codecDefinitions !== undefined,
      hasTextDef: builder.codecDefinitions.text !== undefined,
      typeId: builder.codecDefinitions.text.typeId,
      scalar: builder.codecDefinitions.text.scalar,
      codec: builder.codecDefinitions.text.codec,
      dataType: builder.dataTypes.text,
    }).toMatchObject({
      hasCodecTypes: true,
      hasDataTypes: true,
      hasCodecDefinitions: true,
      hasTextDef: true,
      typeId: 'test/type1@1',
      scalar: 'text',
      codec: codec1,
      dataType: 'test/type1@1',
    });
  });

  it('adds multiple codecs to builder', () => {
    const codec1 = codec({
      typeId: 'test/type1@1',
      targetTypes: ['text'],
      encode: (value: string) => value,
      decode: (wire: string) => wire,
    });

    const codec2 = codec({
      typeId: 'test/type2@1',
      targetTypes: ['int4'],
      encode: (value: number) => value,
      decode: (wire: number) => wire,
    });

    const builder = defineCodecs().add('text', codec1).add('int4', codec2);
    expect({
      hasTextDef: builder.codecDefinitions.text !== undefined,
      hasInt4Def: builder.codecDefinitions.int4 !== undefined,
      textTypeId: builder.codecDefinitions.text.typeId,
      int4TypeId: builder.codecDefinitions.int4.typeId,
      textDataType: builder.dataTypes.text,
      int4DataType: builder.dataTypes.int4,
    }).toMatchObject({
      hasTextDef: true,
      hasInt4Def: true,
      textTypeId: 'test/type1@1',
      int4TypeId: 'test/type2@1',
      textDataType: 'test/type1@1',
      int4DataType: 'test/type2@1',
    });
  });

  it('overwrites codec when adding with same scalar name', () => {
    const codec1 = codec({
      typeId: 'test/type1@1',
      targetTypes: ['text'],
      encode: (value: string) => value,
      decode: (wire: string) => wire,
    });

    const codec2 = codec({
      typeId: 'test/type2@1',
      targetTypes: ['text'],
      encode: (value: string) => value,
      decode: (wire: string) => wire,
    });

    const builder = defineCodecs().add('text', codec1).add('text', codec2);
    expect({
      typeId: builder.codecDefinitions.text.typeId,
      codec: builder.codecDefinitions.text.codec,
      dataType: builder.dataTypes.text,
    }).toMatchObject({
      typeId: 'test/type2@1',
      codec: codec2,
      dataType: 'test/type2@1',
    });
  });

  it('populates CodecTypes correctly', () => {
    const codec1 = codec({
      typeId: 'test/type1@1',
      targetTypes: ['text'],
      encode: (value: string) => value,
      decode: (wire: string) => wire,
    });

    const builder = defineCodecs().add('text', codec1);
    expect(builder.CodecTypes).toBeDefined();
    expect('test/type1@1' in builder.CodecTypes).toBe(true);
  });
});

describe('codec traits', () => {
  it('codec() factory produces codec with traits', () => {
    const testCodec = codec({
      typeId: 'test/numeric@1',
      targetTypes: ['int4'],
      traits: ['equality', 'order', 'numeric'],
      encode: (value: number) => value,
      decode: (wire: number) => wire,
    });

    expect(testCodec.traits).toEqual(['equality', 'order', 'numeric']);
  });

  it('codec() factory omits traits when not provided', () => {
    const testCodec = codec({
      typeId: 'test/bare@1',
      targetTypes: ['text'],
      encode: (value: string) => value,
      decode: (wire: string) => wire,
    });

    expect(testCodec.traits).toBeUndefined();
  });

  it('hasTrait returns true for declared trait', () => {
    const registry = createCodecRegistry();
    registry.register(
      codec({
        typeId: 'test/num@1',
        targetTypes: ['int'],
        traits: ['equality', 'order', 'numeric'],
        encode: (v: number) => v,
        decode: (w: number) => w,
      }),
    );

    expect(registry.hasTrait('test/num@1', 'numeric')).toBe(true);
    expect(registry.hasTrait('test/num@1', 'equality')).toBe(true);
    expect(registry.hasTrait('test/num@1', 'order')).toBe(true);
  });

  it('hasTrait returns false for undeclared trait', () => {
    const registry = createCodecRegistry();
    registry.register(
      codec({
        typeId: 'test/bool@1',
        targetTypes: ['bool'],
        traits: ['equality', 'boolean'],
        encode: (v: boolean) => v,
        decode: (w: boolean) => w,
      }),
    );

    expect(registry.hasTrait('test/bool@1', 'numeric')).toBe(false);
    expect(registry.hasTrait('test/bool@1', 'order')).toBe(false);
    expect(registry.hasTrait('test/bool@1', 'textual')).toBe(false);
  });

  it('hasTrait returns false for unknown codec', () => {
    const registry = createCodecRegistry();
    expect(registry.hasTrait('unknown/id@1', 'equality')).toBe(false);
  });

  it('hasTrait returns false for codec without traits', () => {
    const registry = createCodecRegistry();
    registry.register(
      codec({
        typeId: 'test/bare@1',
        targetTypes: ['text'],
        encode: (v: string) => v,
        decode: (w: string) => w,
      }),
    );

    expect(registry.hasTrait('test/bare@1', 'equality')).toBe(false);
  });

  it('traitsOf returns declared traits', () => {
    const registry = createCodecRegistry();
    registry.register(
      codec({
        typeId: 'test/text@1',
        targetTypes: ['text'],
        traits: ['equality', 'order', 'textual'],
        encode: (v: string) => v,
        decode: (w: string) => w,
      }),
    );

    expect(registry.traitsOf('test/text@1')).toEqual(['equality', 'order', 'textual']);
  });

  it('traitsOf returns empty array for unknown codec', () => {
    const registry = createCodecRegistry();
    expect(registry.traitsOf('unknown/id@1')).toEqual([]);
  });

  it('traitsOf returns empty array for codec without traits', () => {
    const registry = createCodecRegistry();
    registry.register(
      codec({
        typeId: 'test/bare@1',
        targetTypes: ['text'],
        encode: (v: string) => v,
        decode: (w: string) => w,
      }),
    );

    expect(registry.traitsOf('test/bare@1')).toEqual([]);
  });
});

describe('SqlCodecTypes with traits', () => {
  it('SqlCodecTypes carries narrow traits for codecs without init', async () => {
    type SqlCTypes = import('../../src/ast/sql-codecs').SqlCodecTypes;

    // Int (no init/paramsSchema): TTraits inferred as literal tuple
    true satisfies 'numeric' extends SqlCTypes['sql/int@1']['traits'] ? true : false;
    true satisfies 'equality' extends SqlCTypes['sql/int@1']['traits'] ? true : false;
    true satisfies 'order' extends SqlCTypes['sql/int@1']['traits'] ? true : false;
    false satisfies 'textual' extends SqlCTypes['sql/int@1']['traits'] ? true : false;
    false satisfies 'boolean' extends SqlCTypes['sql/int@1']['traits'] ? true : false;

    // Float (no init/paramsSchema): same narrow traits
    true satisfies 'numeric' extends SqlCTypes['sql/float@1']['traits'] ? true : false;
    false satisfies 'textual' extends SqlCTypes['sql/float@1']['traits'] ? true : false;
  });
});
