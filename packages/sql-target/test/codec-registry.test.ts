import { describe, expect, it } from 'vitest';
import { codec, createCodecRegistry } from '../src/codecs';

describe('CodecRegistry', () => {
  describe('createCodecRegistry', () => {
    it('creates empty registry', () => {
      const registry = createCodecRegistry();
      expect(registry).toBeDefined();
      expect(registry.get('nonexistent')).toBeUndefined();
      expect(registry.has('nonexistent')).toBe(false);
    });
  });

  describe('register', () => {
    it('registers a codec', () => {
      const registry = createCodecRegistry();
      const testCodec = codec({
        typeId: 'test/register@1',
        targetTypes: ['register'],
        encode: (value: string) => value,
        decode: (wire: string) => wire,
      });

      registry.register(testCodec);

      expect(registry.has('test/register@1')).toBe(true);
      expect(registry.get('test/register@1')).toBe(testCodec);
    });

    it('throws error when registering duplicate ID', () => {
      const registry = createCodecRegistry();
      const codec1 = codec({
        typeId: 'test/duplicate@1',
        targetTypes: ['duplicate'],
        encode: (value: string) => value,
        decode: (wire: string) => wire,
      });

      const codec2 = codec({
        typeId: 'test/duplicate@1',
        targetTypes: ['duplicate'],
        encode: (value: number) => value,
        decode: (wire: number) => wire,
      });

      registry.register(codec1);

      expect(() => {
        registry.register(codec2);
      }).toThrow("Codec with ID 'test/duplicate@1' is already registered");
    });

    it('registers codec with multiple target types', () => {
      const registry = createCodecRegistry();
      const testCodec = codec({
        typeId: 'test/multi@1',
        targetTypes: ['type1', 'type2', 'type3'],
        encode: (value: string) => value,
        decode: (wire: string) => wire,
      });

      registry.register(testCodec);

      expect(registry.get('test/multi@1')).toBe(testCodec);
      expect(registry.getByScalar('type1')).toContain(testCodec);
      expect(registry.getByScalar('type2')).toContain(testCodec);
      expect(registry.getByScalar('type3')).toContain(testCodec);
    });
  });

  describe('get', () => {
    it('returns undefined for unregistered codec', () => {
      const registry = createCodecRegistry();
      expect(registry.get('test/unregistered@1')).toBeUndefined();
    });

    it('returns registered codec', () => {
      const registry = createCodecRegistry();
      const testCodec = codec({
        typeId: 'test/get@1',
        targetTypes: ['get'],
        encode: (value: string) => value,
        decode: (wire: string) => wire,
      });

      registry.register(testCodec);

      expect(registry.get('test/get@1')).toBe(testCodec);
    });
  });

  describe('has', () => {
    it('returns false for unregistered codec', () => {
      const registry = createCodecRegistry();
      expect(registry.has('test/unregistered@1')).toBe(false);
    });

    it('returns true for registered codec', () => {
      const registry = createCodecRegistry();
      const testCodec = codec({
        typeId: 'test/has@1',
        targetTypes: ['has'],
        encode: (value: string) => value,
        decode: (wire: string) => wire,
      });

      registry.register(testCodec);

      expect(registry.has('test/has@1')).toBe(true);
    });
  });

  describe('getByScalar', () => {
    it('returns empty array for unregistered scalar', () => {
      const registry = createCodecRegistry();
      const result = registry.getByScalar('unregistered');
      expect(result).toEqual([]);
      expect(Object.isFrozen(result)).toBe(true);
    });

    it('returns single codec for scalar', () => {
      const registry = createCodecRegistry();
      const testCodec = codec({
        typeId: 'test/scalar@1',
        targetTypes: ['scalar'],
        encode: (value: string) => value,
        decode: (wire: string) => wire,
      });

      registry.register(testCodec);

      const result = registry.getByScalar('scalar');
      expect(result).toHaveLength(1);
      expect(result[0]).toBe(testCodec);
    });

    it('returns multiple codecs for same scalar', () => {
      const registry = createCodecRegistry();
      const codec1 = codec({
        typeId: 'test/multi1@1',
        targetTypes: ['multi'],
        encode: (value: string) => value,
        decode: (wire: string) => wire,
      });

      const codec2 = codec({
        typeId: 'test/multi2@1',
        targetTypes: ['multi'],
        encode: (value: number) => value,
        decode: (wire: number) => wire,
      });

      registry.register(codec1);
      registry.register(codec2);

      const result = registry.getByScalar('multi');
      expect(result).toHaveLength(2);
      expect(result).toContain(codec1);
      expect(result).toContain(codec2);
    });

    it('returns frozen array for unregistered scalar', () => {
      const registry = createCodecRegistry();
      const result = registry.getByScalar('unregistered');
      expect(Object.isFrozen(result)).toBe(true);
    });
  });

  describe('getDefaultCodec', () => {
    it('returns undefined for unregistered scalar', () => {
      const registry = createCodecRegistry();
      expect(registry.getDefaultCodec('unregistered')).toBeUndefined();
    });

    it('returns first codec for scalar', () => {
      const registry = createCodecRegistry();
      const testCodec = codec({
        typeId: 'test/default@1',
        targetTypes: ['default'],
        encode: (value: string) => value,
        decode: (wire: string) => wire,
      });

      registry.register(testCodec);

      expect(registry.getDefaultCodec('default')).toBe(testCodec);
    });

    it('returns first registered codec when multiple exist', () => {
      const registry = createCodecRegistry();
      const codec1 = codec({
        typeId: 'test/default1@1',
        targetTypes: ['default'],
        encode: (value: string) => value,
        decode: (wire: string) => wire,
      });

      const codec2 = codec({
        typeId: 'test/default2@1',
        targetTypes: ['default'],
        encode: (value: number) => value,
        decode: (wire: number) => wire,
      });

      registry.register(codec1);
      registry.register(codec2);

      expect(registry.getDefaultCodec('default')).toBe(codec1);
    });
  });

  describe('iterator', () => {
    it('iterates over all registered codecs', () => {
      const registry = createCodecRegistry();
      const codec1 = codec({
        typeId: 'test/iter1@1',
        targetTypes: ['iter1'],
        encode: (value: string) => value,
        decode: (wire: string) => wire,
      });

      const codec2 = codec({
        typeId: 'test/iter2@1',
        targetTypes: ['iter2'],
        encode: (value: number) => value,
        decode: (wire: number) => wire,
      });

      registry.register(codec1);
      registry.register(codec2);

      const codecs = Array.from(registry);
      expect(codecs).toHaveLength(2);
      expect(codecs).toContain(codec1);
      expect(codecs).toContain(codec2);
    });

    it('returns empty iterator for empty registry', () => {
      const registry = createCodecRegistry();
      const codecs = Array.from(registry);
      expect(codecs).toHaveLength(0);
    });
  });

  describe('values', () => {
    it('returns iterable of all codecs', () => {
      const registry = createCodecRegistry();
      const codec1 = codec({
        typeId: 'test/values1@1',
        targetTypes: ['values1'],
        encode: (value: string) => value,
        decode: (wire: string) => wire,
      });

      const codec2 = codec({
        typeId: 'test/values2@1',
        targetTypes: ['values2'],
        encode: (value: number) => value,
        decode: (wire: number) => wire,
      });

      registry.register(codec1);
      registry.register(codec2);

      const codecs = Array.from(registry.values());
      expect(codecs).toHaveLength(2);
      expect(codecs).toContain(codec1);
      expect(codecs).toContain(codec2);
    });

    it('returns empty iterable for empty registry', () => {
      const registry = createCodecRegistry();
      const codecs = Array.from(registry.values());
      expect(codecs).toHaveLength(0);
    });
  });
});
