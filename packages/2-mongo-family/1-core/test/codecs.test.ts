import { describe, expect, it } from 'vitest';
import { createMongoCodecRegistry } from '../src/codec-registry';
import { type MongoCodec, mongoCodec } from '../src/codecs';

describe('mongoCodec()', () => {
  it('creates a codec with the given config', () => {
    const codec = mongoCodec({
      typeId: 'test/string@1',
      targetTypes: ['string'],
      decode: (wire: string) => wire,
      encode: (value: string) => value,
    });

    expect(codec.id).toBe('test/string@1');
    expect(codec.targetTypes).toEqual(['string']);
    expect(codec.decode('hello')).toBe('hello');
    expect(codec.encode?.('hello')).toBe('hello');
  });

  it('creates a codec with encode and decode', () => {
    const codec = mongoCodec({
      typeId: 'test/upper@1',
      targetTypes: ['text'],
      decode: (wire: string) => wire.toUpperCase(),
      encode: (value: string) => value.toLowerCase(),
    });

    expect(codec.decode('hello')).toBe('HELLO');
    expect(codec.encode?.('HELLO')).toBe('hello');
  });
});

describe('MongoCodecRegistry', () => {
  function makeCodec(id: string): MongoCodec<string> {
    return mongoCodec({
      typeId: id,
      targetTypes: ['test'],
      decode: (wire: unknown) => wire,
      encode: (value: unknown) => value,
    });
  }

  it('registers and retrieves a codec by id', () => {
    const registry = createMongoCodecRegistry();
    const codec = makeCodec('test/a@1');
    registry.register(codec);

    expect(registry.get('test/a@1')).toBe(codec);
  });

  it('returns undefined for unregistered id', () => {
    const registry = createMongoCodecRegistry();
    expect(registry.get('nonexistent')).toBeUndefined();
  });

  it('has() returns true for registered, false for unregistered', () => {
    const registry = createMongoCodecRegistry();
    const codec = makeCodec('test/b@1');
    registry.register(codec);

    expect(registry.has('test/b@1')).toBe(true);
    expect(registry.has('nope')).toBe(false);
  });

  it('throws on duplicate registration', () => {
    const registry = createMongoCodecRegistry();
    const codec = makeCodec('test/dup@1');
    registry.register(codec);

    expect(() => registry.register(makeCodec('test/dup@1'))).toThrow(
      "Codec with ID 'test/dup@1' is already registered",
    );
  });

  it('iterates over registered codecs', () => {
    const registry = createMongoCodecRegistry();
    const a = makeCodec('test/x@1');
    const b = makeCodec('test/y@1');
    registry.register(a);
    registry.register(b);

    const collected = [...registry];
    expect(collected).toContain(a);
    expect(collected).toContain(b);
    expect(collected).toHaveLength(2);
  });

  it('values() returns an iterable of codecs', () => {
    const registry = createMongoCodecRegistry();
    const a = makeCodec('test/v@1');
    registry.register(a);

    const vals = Array.from(registry.values());
    expect(vals).toEqual([a]);
  });
});
