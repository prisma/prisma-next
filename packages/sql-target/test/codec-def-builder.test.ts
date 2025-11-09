import { describe, expect, it } from 'vitest';
import { codec, defineCodecs } from '../src/codecs';

describe('defineCodecs() function', () => {
  it('returns empty CodecDefBuilder instance', () => {
    const builder = defineCodecs();
    expect(builder).toBeDefined();
    expect(builder.codecDefinitions).toEqual({});
  });

  it('builder starts with empty codecs record', () => {
    const builder = defineCodecs();
    const codecDefinitions = builder.codecDefinitions;
    expect(Object.keys(codecDefinitions).length).toBe(0);
    expect(Object.keys(builder.dataTypes).length).toBe(0);
    expect(Object.keys(builder.CodecTypes).length).toBe(0);
  });
});

describe('CodecDefBuilder interface', () => {
  describe('builder creation', () => {
    it('initializes with empty codecs', () => {
      const builder = defineCodecs();
      expect(builder.codecDefinitions).toEqual({});
      expect(builder.dataTypes).toEqual({});
    });

    it('initializes with provided codecs', () => {
      const testCodec = codec({
        typeId: 'test/init@1',
        targetTypes: ['init'],
        encode: (value: string) => value,
        decode: (wire: string) => wire,
      });

      const builder = defineCodecs().add('init', testCodec);
      const definitions = builder.codecDefinitions;
      expect(definitions.init).toBeDefined();
      expect(definitions.init?.typeId).toBe('test/init@1');
      expect(definitions.init?.scalar).toBe('init');
      expect(definitions.init?.codec).toBe(testCodec);
    });

    it('populates CodecTypes property correctly', () => {
      const testCodec = codec({
        typeId: 'test/codectypes@1',
        targetTypes: ['codectypes'],
        encode: (value: string) => value,
        decode: (wire: string) => wire,
      });

      const builder = defineCodecs().add('codectypes', testCodec);
      expect(builder.CodecTypes).toBeDefined();
      expect(builder.CodecTypes['test/codectypes@1']).toBeDefined();
      expect(builder.CodecTypes['test/codectypes@1']).toHaveProperty('input');
      expect(builder.CodecTypes['test/codectypes@1']).toHaveProperty('output');
    });
  });

  describe('add() method', () => {
    it('adds single codec and returns new builder', () => {
      const testCodec = codec({
        typeId: 'test/add@1',
        targetTypes: ['add'],
        encode: (value: string) => value,
        decode: (wire: string) => wire,
      });

      const builder = defineCodecs().add('add', testCodec);
      expect(builder).toBeDefined();
      expect(builder.codecDefinitions).toBeDefined();
      expect(builder.codecDefinitions.add).toBeDefined();
      expect(builder.codecDefinitions.add?.typeId).toBe('test/add@1');
    });

    it('preserves existing codecs when adding new one', () => {
      const codec1 = codec({
        typeId: 'test/preserve1@1',
        targetTypes: ['preserve1'],
        encode: (value: string) => value,
        decode: (wire: string) => wire,
      });

      const codec2 = codec({
        typeId: 'test/preserve2@1',
        targetTypes: ['preserve2'],
        encode: (value: number) => value,
        decode: (wire: number) => wire,
      });

      const builder = defineCodecs().add('preserve1', codec1).add('preserve2', codec2);

      expect(builder.codecDefinitions.preserve1).toBeDefined();
      expect(builder.codecDefinitions.preserve2).toBeDefined();
      expect(builder.codecDefinitions.preserve1?.typeId).toBe('test/preserve1@1');
      expect(builder.codecDefinitions.preserve2?.typeId).toBe('test/preserve2@1');
    });

    it('overwrites existing scalar name if same name used twice', () => {
      const codec1 = codec({
        typeId: 'test/overwrite1@1',
        targetTypes: ['overwrite'],
        encode: (value: string) => value,
        decode: (wire: string) => wire,
      });

      const codec2 = codec({
        typeId: 'test/overwrite2@1',
        targetTypes: ['overwrite'],
        encode: (value: number) => value,
        decode: (wire: number) => wire,
      });

      const builder = defineCodecs().add('overwrite', codec1).add('overwrite', codec2);

      expect(builder.codecDefinitions.overwrite).toBeDefined();
      expect(builder.codecDefinitions.overwrite?.typeId).toBe('test/overwrite2@1');
      expect(builder.codecDefinitions.overwrite?.codec).toBe(codec2);
    });

    it('is chainable - can add multiple codecs in sequence', () => {
      const codec1 = codec({
        typeId: 'test/chain1@1',
        targetTypes: ['chain1'],
        encode: (value: string) => value,
        decode: (wire: string) => wire,
      });

      const codec2 = codec({
        typeId: 'test/chain2@1',
        targetTypes: ['chain2'],
        encode: (value: number) => value,
        decode: (wire: number) => wire,
      });

      const codec3 = codec({
        typeId: 'test/chain3@1',
        targetTypes: ['chain3'],
        encode: (value: boolean) => value,
        decode: (wire: boolean) => wire,
      });

      const builder = defineCodecs()
        .add('chain1', codec1)
        .add('chain2', codec2)
        .add('chain3', codec3);

      expect(builder.codecDefinitions.chain1).toBeDefined();
      expect(builder.codecDefinitions.chain2).toBeDefined();
      expect(builder.codecDefinitions.chain3).toBeDefined();
      expect(Object.keys(builder.codecDefinitions).length).toBe(3);
    });

    it('returns new builder instance (immutability)', () => {
      const codec1 = codec({
        typeId: 'test/immutable1@1',
        targetTypes: ['immutable1'],
        encode: (value: string) => value,
        decode: (wire: string) => wire,
      });

      const builder1 = defineCodecs();
      const builder2 = builder1.add('immutable1', codec1);

      expect(builder1).not.toBe(builder2);
      expect(
        'immutable1' in builder1.codecDefinitions
          ? builder1.codecDefinitions.immutable1
          : undefined,
      ).toBeUndefined();
      expect(builder2.codecDefinitions.immutable1).toBeDefined();
    });
  });

  describe('codecDefinitions getter', () => {
    it('returns structure with typeId, scalar, codec, input, output, jsType', () => {
      const testCodec = codec({
        typeId: 'test/structure@1',
        targetTypes: ['structure'],
        encode: (value: string) => value,
        decode: (wire: string) => wire,
      });

      const builder = defineCodecs().add('structure', testCodec);
      const definitions = builder.codecDefinitions;

      expect(definitions.structure).toBeDefined();
      expect(definitions.structure).toHaveProperty('typeId');
      expect(definitions.structure).toHaveProperty('scalar');
      expect(definitions.structure).toHaveProperty('codec');
      expect(definitions.structure).toHaveProperty('input');
      expect(definitions.structure).toHaveProperty('output');
      expect(definitions.structure).toHaveProperty('jsType');
    });

    it('includes all codecs', () => {
      const codec1 = codec({
        typeId: 'test/all1@1',
        targetTypes: ['all1'],
        encode: (value: string) => value,
        decode: (wire: string) => wire,
      });

      const codec2 = codec({
        typeId: 'test/all2@1',
        targetTypes: ['all2'],
        encode: (value: number) => value,
        decode: (wire: number) => wire,
      });

      const codec3 = codec({
        typeId: 'test/all3@1',
        targetTypes: ['all3'],
        encode: (value: boolean) => value,
        decode: (wire: boolean) => wire,
      });

      const builder = defineCodecs().add('all1', codec1).add('all2', codec2).add('all3', codec3);

      const definitions = builder.codecDefinitions;
      expect(definitions.all1).toBeDefined();
      expect(definitions.all2).toBeDefined();
      expect(definitions.all3).toBeDefined();
      expect(Object.keys(definitions).length).toBe(3);
    });

    it('preserves correct typeId values', () => {
      const testCodec = codec({
        typeId: 'test/typeid@1',
        targetTypes: ['typeid'],
        encode: (value: string) => value,
        decode: (wire: string) => wire,
      });

      const builder = defineCodecs().add('typeid', testCodec);
      expect(builder.codecDefinitions.typeid?.typeId).toBe('test/typeid@1');
    });

    it('preserves correct scalar names', () => {
      const testCodec = codec({
        typeId: 'test/scalar@1',
        targetTypes: ['scalar'],
        encode: (value: string) => value,
        decode: (wire: string) => wire,
      });

      const builder = defineCodecs().add('scalar', testCodec);
      expect(builder.codecDefinitions.scalar?.scalar).toBe('scalar');
    });
  });

  describe('dataTypes getter', () => {
    it('maps scalar names to type IDs', () => {
      const testCodec = codec({
        typeId: 'test/datatypes@1',
        targetTypes: ['datatypes'],
        encode: (value: string) => value,
        decode: (wire: string) => wire,
      });

      const builder = defineCodecs().add('datatypes', testCodec);
      expect(builder.dataTypes.datatypes).toBe('test/datatypes@1');
    });

    it('includes all codecs', () => {
      const codec1 = codec({
        typeId: 'test/data1@1',
        targetTypes: ['data1'],
        encode: (value: string) => value,
        decode: (wire: string) => wire,
      });

      const codec2 = codec({
        typeId: 'test/data2@1',
        targetTypes: ['data2'],
        encode: (value: number) => value,
        decode: (wire: number) => wire,
      });

      const builder = defineCodecs().add('data1', codec1).add('data2', codec2);

      expect(builder.dataTypes.data1).toBe('test/data1@1');
      expect(builder.dataTypes.data2).toBe('test/data2@1');
      expect(Object.keys(builder.dataTypes).length).toBe(2);
    });

    it('preserves correct type IDs as literals', () => {
      const testCodec = codec({
        typeId: 'test/literal@1',
        targetTypes: ['literal'],
        encode: (value: string) => value,
        decode: (wire: string) => wire,
      });

      const builder = defineCodecs().add('literal', testCodec);
      const typeId = builder.dataTypes.literal;
      expect(typeId).toBe('test/literal@1');
      expect(typeof typeId).toBe('string');
    });
  });

  describe('CodecTypes property', () => {
    it('is populated in constructor', () => {
      const testCodec = codec({
        typeId: 'test/codectypes@1',
        targetTypes: ['codectypes'],
        encode: (value: string) => value,
        decode: (wire: string) => wire,
      });

      const builder = defineCodecs().add('codectypes', testCodec);
      expect(builder.CodecTypes).toBeDefined();
      expect(Object.keys(builder.CodecTypes).length).toBeGreaterThan(0);
    });

    it('contains all codec IDs as keys', () => {
      const codec1 = codec({
        typeId: 'test/key1@1',
        targetTypes: ['key1'],
        encode: (value: string) => value,
        decode: (wire: string) => wire,
      });

      const codec2 = codec({
        typeId: 'test/key2@1',
        targetTypes: ['key2'],
        encode: (value: number) => value,
        decode: (wire: number) => wire,
      });

      const builder = defineCodecs().add('key1', codec1).add('key2', codec2);

      expect(builder.CodecTypes['test/key1@1']).toBeDefined();
      expect(builder.CodecTypes['test/key2@1']).toBeDefined();
    });

    it('each entry has input and output properties', () => {
      const testCodec = codec({
        typeId: 'test/inputoutput@1',
        targetTypes: ['inputoutput'],
        encode: (value: string) => value,
        decode: (wire: string) => wire,
      });

      const builder = defineCodecs().add('inputoutput', testCodec);
      const codecType = builder.CodecTypes['test/inputoutput@1'];

      expect(codecType).toBeDefined();
      expect(codecType).toHaveProperty('input');
      expect(codecType).toHaveProperty('output');
    });
  });

  // Scalar-to-JS mappings are derived directly from codec outputs now.
});
