import { describe, expect, it } from 'vitest';
import { codec } from '../../src/ast/codec-types';

describe('codec() factory — query-time methods are Promise-returning', () => {
  it('lifts a sync encode into a Promise-returning method', async () => {
    const c = codec({
      typeId: 'demo/sync-encode@1',
      targetTypes: ['text'],
      encode: (value: string) => value.toUpperCase(),
      decode: (wire: string) => wire,
    });

    const encoded = c.encode!('hello');
    expect(encoded).toBeInstanceOf(Promise);
    expect(await encoded).toBe('HELLO');
  });

  it('lifts a sync decode into a Promise-returning method', async () => {
    const c = codec({
      typeId: 'demo/sync-decode@1',
      targetTypes: ['text'],
      encode: (value: string) => value,
      decode: (wire: string) => wire.toLowerCase(),
    });

    const decoded = c.decode('WORLD');
    expect(decoded).toBeInstanceOf(Promise);
    expect(await decoded).toBe('world');
  });

  it('accepts an async encode and produces a Promise-returning method', async () => {
    const c = codec({
      typeId: 'demo/async-encode@1',
      targetTypes: ['text'],
      encode: async (value: string) => value.toUpperCase(),
      decode: (wire: string) => wire,
    });

    const encoded = c.encode!('hello');
    expect(encoded).toBeInstanceOf(Promise);
    expect(await encoded).toBe('HELLO');
  });

  it('accepts an async decode and produces a Promise-returning method', async () => {
    const c = codec({
      typeId: 'demo/async-decode@1',
      targetTypes: ['text'],
      encode: (value: string) => value,
      decode: async (wire: string) => wire.toLowerCase(),
    });

    const decoded = c.decode('WORLD');
    expect(decoded).toBeInstanceOf(Promise);
    expect(await decoded).toBe('world');
  });

  it('accepts a mix of sync encode + async decode', async () => {
    const c = codec({
      typeId: 'demo/mixed-a@1',
      targetTypes: ['text'],
      encode: (value: string) => value,
      decode: async (wire: string) => wire.toUpperCase(),
    });

    expect(c.encode!('a')).toBeInstanceOf(Promise);
    expect(c.decode('a')).toBeInstanceOf(Promise);
    expect(await c.encode!('a')).toBe('a');
    expect(await c.decode('a')).toBe('A');
  });

  it('accepts a mix of async encode + sync decode', async () => {
    const c = codec({
      typeId: 'demo/mixed-b@1',
      targetTypes: ['text'],
      encode: async (value: string) => value.toUpperCase(),
      decode: (wire: string) => wire,
    });

    expect(c.encode!('a')).toBeInstanceOf(Promise);
    expect(c.decode('a')).toBeInstanceOf(Promise);
    expect(await c.encode!('a')).toBe('A');
    expect(await c.decode('a')).toBe('a');
  });

  it('installs an identity encode default when encode is omitted', async () => {
    const c = codec({
      typeId: 'demo/identity-default@1',
      targetTypes: ['text'],
      decode: (wire: string) => wire,
    });

    expect(c.encode).toBeDefined();
    const encoded = c.encode!('hello');
    expect(encoded).toBeInstanceOf(Promise);
    expect(await encoded).toBe('hello');
  });

  it('passes encodeJson and decodeJson through as synchronous methods', () => {
    const c = codec({
      typeId: 'demo/json-passthrough@1',
      targetTypes: ['text'],
      encode: (value: string) => value,
      decode: (wire: string) => wire,
      encodeJson: (value: string) => value.toUpperCase(),
      decodeJson: (json) => `prefixed:${json as string}`,
    });

    const encodedJson = c.encodeJson('hello');
    const decodedJson = c.decodeJson('hello');
    expect(encodedJson).toBe('HELLO');
    expect(decodedJson).toBe('prefixed:hello');
    expect(encodedJson).not.toBeInstanceOf(Promise);
    expect(decodedJson).not.toBeInstanceOf(Promise);
  });

  it('preserves renderOutputType as synchronous when provided', () => {
    const c = codec({
      typeId: 'demo/render@1',
      targetTypes: ['text'],
      encode: (value: string) => value,
      decode: (wire: string) => wire,
      renderOutputType: (params) => `Demo<${String(params['size'] ?? 'unknown')}>`,
    });

    expect(c.renderOutputType).toBeDefined();
    const rendered = c.renderOutputType!({ size: 8 });
    expect(rendered).toBe('Demo<8>');
    expect(rendered).not.toBeInstanceOf(Promise);
  });

  it('omits renderOutputType when not provided', () => {
    const c = codec({
      typeId: 'demo/no-render@1',
      targetTypes: ['text'],
      encode: (value: string) => value,
      decode: (wire: string) => wire,
    });

    expect(c.renderOutputType).toBeUndefined();
  });
});
