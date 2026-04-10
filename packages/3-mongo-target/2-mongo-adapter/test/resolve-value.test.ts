import { createMongoCodecRegistry, mongoCodec } from '@prisma-next/mongo-codec';
import { MongoParamRef } from '@prisma-next/mongo-value';
import { describe, expect, it } from 'vitest';
import { resolveValue } from '../src/resolve-value';

const uppercaseCodec = mongoCodec({
  typeId: 'test/uppercase@1',
  targetTypes: ['string'],
  decode: (wire: string) => wire.toLowerCase(),
  encode: (value: string) => value.toUpperCase(),
});

function testRegistry() {
  const registry = createMongoCodecRegistry();
  registry.register(uppercaseCodec);
  return registry;
}

describe('resolveValue', () => {
  it('unwraps MongoParamRef without codec registry', () => {
    const ref = new MongoParamRef('hello');
    expect(resolveValue(ref)).toBe('hello');
  });

  it('unwraps MongoParamRef without codecId even when registry is provided', () => {
    const ref = new MongoParamRef('hello');
    expect(resolveValue(ref, testRegistry())).toBe('hello');
  });

  it('applies codec encode when MongoParamRef has codecId and registry has codec', () => {
    const ref = new MongoParamRef('hello', { codecId: 'test/uppercase@1' });
    expect(resolveValue(ref, testRegistry())).toBe('HELLO');
  });

  it('falls back to raw value when codecId is set but registry is not provided', () => {
    const ref = new MongoParamRef('hello', { codecId: 'test/uppercase@1' });
    expect(resolveValue(ref)).toBe('hello');
  });

  it('falls back to raw value when codecId is not in registry', () => {
    const ref = new MongoParamRef('hello', { codecId: 'test/unknown@1' });
    expect(resolveValue(ref, testRegistry())).toBe('hello');
  });

  it('encodes nested MongoParamRef with codecId inside object', () => {
    const doc = {
      name: new MongoParamRef('alice'),
      label: new MongoParamRef('greeting', { codecId: 'test/uppercase@1' }),
    };
    const result = resolveValue(doc, testRegistry()) as Record<string, unknown>;
    expect(result['name']).toBe('alice');
    expect(result['label']).toBe('GREETING');
  });

  it('encodes MongoParamRef with codecId inside array', () => {
    const arr = [new MongoParamRef('a', { codecId: 'test/uppercase@1' }), new MongoParamRef('b')];
    const result = resolveValue(arr, testRegistry()) as unknown[];
    expect(result[0]).toBe('A');
    expect(result[1]).toBe('b');
  });

  it('preserves null, primitive, and Date values', () => {
    expect(resolveValue(null)).toBeNull();
    expect(resolveValue(42)).toBe(42);
    expect(resolveValue('raw')).toBe('raw');
    const d = new Date();
    expect(resolveValue(d)).toBe(d);
  });
});
