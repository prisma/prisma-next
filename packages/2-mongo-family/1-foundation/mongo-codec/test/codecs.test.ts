import { describe, expect, it } from 'vitest';
import { createMongoCodecRegistry } from '../src/codec-registry';
import { type MongoCodec, mongoCodec } from '../src/codecs';

describe('mongoCodec()', () => {
  it('creates a codec with the given config', async () => {
    const codec = mongoCodec({
      typeId: 'test/string@1',
      targetTypes: ['string'],
      decode: (wire: string) => wire,
      encode: (value: string) => value,
    });

    expect(codec.id).toBe('test/string@1');
    expect(codec.targetTypes).toEqual(['string']);
    expect(codec.traits).toBeUndefined();
    expect(await codec.decode('hello')).toBe('hello');
    expect(await codec.encode('hello')).toBe('hello');
  });

  it('creates a codec with encode and decode', async () => {
    const codec = mongoCodec({
      typeId: 'test/upper@1',
      targetTypes: ['text'],
      decode: (wire: string) => wire.toUpperCase(),
      encode: (value: string) => value.toLowerCase(),
    });

    expect(await codec.decode('hello')).toBe('HELLO');
    expect(await codec.encode('HELLO')).toBe('hello');
  });

  it('lifts sync author functions to Promise-returning methods', () => {
    const codec = mongoCodec({
      typeId: 'test/sync@1',
      targetTypes: ['string'],
      decode: (wire: string) => wire,
      encode: (value: string) => value,
    });

    const decoded = codec.decode('x');
    const encoded = codec.encode('y');
    expect(typeof (decoded as { then?: unknown }).then).toBe('function');
    expect(typeof (encoded as { then?: unknown }).then).toBe('function');
  });

  it('accepts async author functions and uses them directly', async () => {
    const codec = mongoCodec({
      typeId: 'test/async@1',
      targetTypes: ['string'],
      decode: async (wire: string) => `decoded:${wire}`,
      encode: async (value: string) => `encoded:${value}`,
    });

    expect(await codec.decode('a')).toBe('decoded:a');
    expect(await codec.encode('b')).toBe('encoded:b');
  });

  it('uses an identity default when encode is omitted', async () => {
    const codec = mongoCodec({
      typeId: 'test/identity-encode@1',
      targetTypes: ['string'],
      decode: (wire: string) => wire.toUpperCase(),
    });

    expect(await codec.encode('hello')).toBe('hello');
    expect(await codec.decode('hello')).toBe('HELLO');
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
