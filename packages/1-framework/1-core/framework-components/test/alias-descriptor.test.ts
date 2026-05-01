import type { StandardSchemaV1 } from '@standard-schema/spec';
import { describe, expect, it } from 'vitest';
import {
  aliasDescriptor,
  type Codec,
  type CodecDescriptor,
  voidParamsSchema,
} from '../src/exports/codec';

function makeBaseDescriptor(): CodecDescriptor<void> {
  const sharedCodec: Codec = {
    id: 'demo/base@1',
    encode: (value) => Promise.resolve(value),
    decode: (wire) => Promise.resolve(wire),
    encodeJson: () => null,
    decodeJson: (json) => json,
  };
  return {
    codecId: 'demo/base@1',
    traits: ['equality'],
    targetTypes: ['base'],
    paramsSchema: voidParamsSchema,
    factory: () => () => sharedCodec,
    meta: { db: { sql: { postgres: { nativeType: 'base' } } } },
  };
}

describe('aliasDescriptor', () => {
  it('overlays codecId, targetTypes, meta on the base descriptor', () => {
    const base = makeBaseDescriptor();
    const alias = aliasDescriptor(base, {
      codecId: 'demo/alias@1',
      targetTypes: ['alias'],
      meta: { db: { sql: { postgres: { nativeType: 'alias' } } } },
    });

    expect(alias.codecId).toBe('demo/alias@1');
    expect(alias.targetTypes).toEqual(['alias']);
    expect(alias.meta).toEqual({ db: { sql: { postgres: { nativeType: 'alias' } } } });
  });

  it('preserves traits and paramsSchema from the base', () => {
    const base = makeBaseDescriptor();
    const alias = aliasDescriptor(base, {
      codecId: 'demo/alias@1',
      targetTypes: ['alias'],
    });

    expect(alias.traits).toEqual(base.traits);
    expect(alias.paramsSchema).toBe(base.paramsSchema);
  });

  it('rewrites id on the resolved codec to the alias codecId', () => {
    const base = makeBaseDescriptor();
    const alias = aliasDescriptor(base, {
      codecId: 'demo/alias@1',
      targetTypes: ['alias'],
    });

    const resolved = alias.factory()({ name: '<shared:demo/alias@1>' });
    expect(resolved.id).toBe('demo/alias@1');
  });

  it('delegates encode/decode behavior to the base factory', async () => {
    const base = makeBaseDescriptor();
    const alias = aliasDescriptor(base, {
      codecId: 'demo/alias@1',
      targetTypes: ['alias'],
    });

    const resolved = alias.factory()({ name: '<shared:demo/alias@1>' });
    expect(await resolved.encode('hello', {})).toBe('hello');
    expect(await resolved.decode('world', {})).toBe('world');
  });

  it('omits meta when overrides.meta is undefined', () => {
    const base = makeBaseDescriptor();
    const alias = aliasDescriptor(base, {
      codecId: 'demo/alias@1',
      targetTypes: ['alias'],
    });
    expect('meta' in alias).toBe(false);
  });

  it('forwards renderOutputType from base when present', () => {
    const renderOutputType = (params: { length: number }) => `Sized<${params.length}>`;
    const sizedParamsSchema: StandardSchemaV1<{ length: number }> = {
      '~standard': {
        version: 1,
        vendor: 'test',
        validate: (input) => ({ value: input as { length: number } }),
      },
    };
    const base: CodecDescriptor<{ length: number }> = {
      codecId: 'demo/sized@1',
      traits: [],
      targetTypes: ['sized'],
      paramsSchema: sizedParamsSchema,
      renderOutputType,
      factory:
        (_params) =>
        (_ctx): Codec => ({
          id: 'demo/sized@1',
          encode: (v) => Promise.resolve(v),
          decode: (w) => Promise.resolve(w),
          encodeJson: () => null,
          decodeJson: (j) => j,
        }),
    };

    const alias = aliasDescriptor(base, {
      codecId: 'demo/sized-alias@1',
      targetTypes: ['sized-alias'],
    });
    expect(alias.renderOutputType).toBe(renderOutputType);
  });
});
