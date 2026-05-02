import { describe, expect, it } from 'vitest';
import { buildCodec } from '../src/exports/codec';

describe('buildCodec', () => {
  it('promise-lifts a sync encode/decode pair', async () => {
    const codec = buildCodec({
      id: 'demo/sync@1',
      encode: (value: string) => `enc:${value}`,
      decode: (wire: string) => `dec:${wire}`,
    });

    expect(codec.id).toBe('demo/sync@1');
    await expect(codec.encode('a', {})).resolves.toBe('enc:a');
    await expect(codec.decode('b', {})).resolves.toBe('dec:b');
  });

  it('passes through async encode/decode without double-wrapping', async () => {
    const codec = buildCodec({
      id: 'demo/async@1',
      encode: async (value: string) => `enc:${value}`,
      decode: async (wire: string) => `dec:${wire}`,
    });

    await expect(codec.encode('a', {})).resolves.toBe('enc:a');
    await expect(codec.decode('b', {})).resolves.toBe('dec:b');
  });

  it('rejects when the author throws synchronously', async () => {
    const codec = buildCodec({
      id: 'demo/throw@1',
      encode: () => {
        throw new Error('boom');
      },
      decode: (wire: unknown) => wire,
    });

    await expect(codec.encode('x', {})).rejects.toThrow('boom');
  });

  it('defaults encodeJson/decodeJson to identity', () => {
    const codec = buildCodec<'demo/json@1', string, string>({
      id: 'demo/json@1',
      encode: (value) => value,
      decode: (wire) => wire,
    });

    expect(codec.encodeJson('hello')).toBe('hello');
    expect(codec.decodeJson('world')).toBe('world');
  });

  it('honours explicit encodeJson/decodeJson when supplied', () => {
    const codec = buildCodec<'demo/date@1', string, Date>({
      id: 'demo/date@1',
      encode: (value) => value.toISOString(),
      decode: (wire) => new Date(wire),
      encodeJson: (value) => value.toISOString(),
      decodeJson: (json) => {
        if (typeof json !== 'string') {
          throw new TypeError('expected ISO date string');
        }
        return new Date(json);
      },
    });

    const sample = new Date('2024-01-02T03:04:05.000Z');
    expect(codec.encodeJson(sample)).toBe('2024-01-02T03:04:05.000Z');
    expect(codec.decodeJson('2024-01-02T03:04:05.000Z')).toEqual(sample);
  });

  it('does not accept legacy contributor metadata fields', () => {
    // Type-level pin: `buildCodec` accepts only the narrow runtime shape.
    // Adding `targetTypes`, `traits`, `meta`, `paramsSchema`, `init`, or
    // `renderOutputType` must be a compile error so this helper cannot be
    // used as a back-door for a wide-spec contributor surface.
    // @ts-expect-error - targetTypes is not part of the narrow runtime shape
    buildCodec({ id: 'x@1', encode: (v) => v, decode: (w) => w, targetTypes: ['x'] });
    // @ts-expect-error - traits is not part of the narrow runtime shape
    buildCodec({ id: 'x@1', encode: (v) => v, decode: (w) => w, traits: ['equality'] });
    // @ts-expect-error - meta is not part of the narrow runtime shape
    buildCodec({ id: 'x@1', encode: (v) => v, decode: (w) => w, meta: {} });
    // @ts-expect-error - paramsSchema is not part of the narrow runtime shape
    buildCodec({ id: 'x@1', encode: (v) => v, decode: (w) => w, paramsSchema: {} });
    // @ts-expect-error - renderOutputType is not part of the narrow runtime shape
    buildCodec({ id: 'x@1', encode: (v) => v, decode: (w) => w, renderOutputType: () => '' });
  });
});
