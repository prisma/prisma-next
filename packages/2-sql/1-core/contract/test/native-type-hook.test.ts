import type { Codec, CodecLookup } from '@prisma-next/framework-components/codec';
import { describe, expect, it } from 'vitest';
import {
  attachNativeTypeFor,
  codecEnforcesValueSet,
  providesEnforcesValueSet,
  providesNativeTypeFor,
} from '../src/native-type-hook';

const baseLookup: CodecLookup = {
  get: () => undefined,
  targetTypesFor: () => undefined,
  metaFor: () => undefined,
  renderOutputTypeFor: () => undefined,
};

describe('providesNativeTypeFor', () => {
  it('true for a descriptor exposing a nativeTypeFor function', () => {
    const descriptor = { codecId: 'pg/enum@1', nativeTypeFor: () => 'auth.aal_level' };
    expect(providesNativeTypeFor(descriptor)).toBe(true);
  });

  it('false for a descriptor without nativeTypeFor', () => {
    const descriptor = { codecId: 'pg/int4@1' };
    expect(providesNativeTypeFor(descriptor)).toBe(false);
  });

  it('false when nativeTypeFor is not a function', () => {
    const descriptor = { codecId: 'pg/int4@1', nativeTypeFor: 'not-a-function' };
    expect(providesNativeTypeFor(descriptor)).toBe(false);
  });

  it('false for null and non-object values', () => {
    expect(providesNativeTypeFor(null)).toBe(false);
    expect(providesNativeTypeFor(undefined)).toBe(false);
    expect(providesNativeTypeFor('pg/enum@1')).toBe(false);
  });
});

describe('attachNativeTypeFor', () => {
  it('wires nativeTypeFor for a descriptor that provides the hook', () => {
    const enumDescriptor = {
      codecId: 'pg/enum@1',
      nativeTypeFor: (typeParams: unknown) =>
        typeParams !== null && typeof typeParams === 'object' && 'typeName' in typeParams
          ? String((typeParams as { typeName: unknown }).typeName)
          : undefined,
    };

    const lookup = attachNativeTypeFor(baseLookup, [enumDescriptor]);

    expect(lookup.nativeTypeFor?.('pg/enum@1', { typeName: 'auth.aal_level' })).toBe(
      'auth.aal_level',
    );
  });

  it('returns undefined for a codec id with no hook', () => {
    const intDescriptor = { codecId: 'pg/int4@1' };

    const lookup = attachNativeTypeFor(baseLookup, [intDescriptor]);

    expect(lookup.nativeTypeFor?.('pg/int4@1', undefined)).toBeUndefined();
  });

  it('returns undefined for an unknown codec id', () => {
    const lookup = attachNativeTypeFor(baseLookup, []);

    expect(lookup.nativeTypeFor?.('pg/enum@1', { typeName: 'auth.aal_level' })).toBeUndefined();
  });

  it('delegates every other CodecLookup member to the wrapped lookup', () => {
    const wrapped: CodecLookup = {
      get: () => undefined,
      targetTypesFor: (id) => (id === 'pg/enum@1' ? ['text'] : undefined),
      metaFor: (id) =>
        id === 'pg/enum@1' ? { db: { sql: { postgres: { nativeType: 'text' } } } } : undefined,
      renderOutputTypeFor: () => undefined,
      renderInputTypeFor: (id) => (id === 'pg/enum@1' ? 'AalLevel' : undefined),
      renderValueLiteralFor: (id, value) => (id === 'pg/enum@1' ? String(value) : undefined),
    };

    const lookup = attachNativeTypeFor(wrapped, []);

    expect(lookup.targetTypesFor('pg/enum@1')).toEqual(['text']);
    expect(lookup.metaFor('pg/enum@1')).toEqual({
      db: { sql: { postgres: { nativeType: 'text' } } },
    });
    expect(lookup.renderInputTypeFor?.('pg/enum@1', {})).toBe('AalLevel');
    expect(lookup.renderValueLiteralFor?.('pg/enum@1', 'aal2', 'output')).toBe('aal2');
  });
});

describe('providesEnforcesValueSet', () => {
  it('true for a descriptor with enforcesValueSet: true', () => {
    expect(providesEnforcesValueSet({ codecId: 'pg/enum@1', enforcesValueSet: true })).toBe(true);
  });

  it('false for a descriptor without enforcesValueSet', () => {
    expect(providesEnforcesValueSet({ codecId: 'pg/text@1' })).toBe(false);
  });

  it('false when enforcesValueSet is not exactly true', () => {
    expect(providesEnforcesValueSet({ codecId: 'pg/text@1', enforcesValueSet: false })).toBe(false);
  });

  it('false for null and non-object values', () => {
    expect(providesEnforcesValueSet(null)).toBe(false);
    expect(providesEnforcesValueSet(undefined)).toBe(false);
  });
});

function stubCodecWithDescriptor(id: string, descriptor: unknown): Codec {
  const codec = {
    id,
    descriptor,
    encode: () => Promise.reject(new Error('unused')),
    decode: () => Promise.reject(new Error('unused')),
    encodeJson: (value: unknown) => value,
    decodeJson: (json: unknown) => json,
  };
  return codec as Codec;
}

describe('codecEnforcesValueSet', () => {
  it('true when the codec instance carries a descriptor with enforcesValueSet: true', () => {
    const codec = stubCodecWithDescriptor('pg/enum@1', {
      codecId: 'pg/enum@1',
      enforcesValueSet: true,
    });
    const lookup: CodecLookup = {
      ...baseLookup,
      get: (id) => (id === 'pg/enum@1' ? codec : undefined),
    };

    expect(codecEnforcesValueSet(lookup, 'pg/enum@1')).toBe(true);
  });

  it('false when the codec instance carries a descriptor without the marker', () => {
    const codec = stubCodecWithDescriptor('pg/text@1', { codecId: 'pg/text@1' });
    const lookup: CodecLookup = {
      ...baseLookup,
      get: (id) => (id === 'pg/text@1' ? codec : undefined),
    };

    expect(codecEnforcesValueSet(lookup, 'pg/text@1')).toBe(false);
  });

  it('false when the codec instance carries no descriptor back-reference', () => {
    const codec: Codec = {
      id: 'pg/text@1',
      encode: () => Promise.reject(new Error('unused')),
      decode: () => Promise.reject(new Error('unused')),
      encodeJson: (value) => value,
      decodeJson: (json) => json,
    };
    const lookup: CodecLookup = {
      ...baseLookup,
      get: (id) => (id === 'pg/text@1' ? codec : undefined),
    };

    expect(codecEnforcesValueSet(lookup, 'pg/text@1')).toBe(false);
  });

  it('false for an unknown codec id', () => {
    expect(codecEnforcesValueSet(baseLookup, 'pg/enum@1')).toBe(false);
  });

  it('false when the lookup itself is undefined', () => {
    expect(codecEnforcesValueSet(undefined, 'pg/enum@1')).toBe(false);
  });
});
