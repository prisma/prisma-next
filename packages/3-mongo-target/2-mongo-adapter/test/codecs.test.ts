import { createOperationRegistry } from '@prisma-next/operations';
import { ObjectId } from 'mongodb';
import { describe, expect, it } from 'vitest';
import { MONGO_DOUBLE_CODEC_ID, MONGO_VECTOR_CODEC_ID } from '../src/core/codec-ids';
import {
  mongoBooleanCodec,
  mongoDateCodec,
  mongoDoubleCodec,
  mongoInt32Codec,
  mongoObjectIdCodec,
  mongoStringCodec,
  mongoVectorCodec,
} from '../src/core/codecs';
import { mongoVectorNearOperation, mongoVectorOperationDescriptors } from '../src/core/operations';

describe('mongoObjectIdCodec', () => {
  it('decodes ObjectId to hex string', async () => {
    const oid = new ObjectId('507f1f77bcf86cd799439011');
    expect(await mongoObjectIdCodec.decode(oid)).toBe('507f1f77bcf86cd799439011');
  });

  it('encodes hex string to ObjectId', async () => {
    const result = await mongoObjectIdCodec.encode('507f1f77bcf86cd799439011');
    expect(result).toBeInstanceOf(ObjectId);
    expect(result.toHexString()).toBe('507f1f77bcf86cd799439011');
  });

  it('round-trips: decode(encode(hex)) === hex', async () => {
    const hex = '65a1b2c3d4e5f6a7b8c9d0e1';
    expect(await mongoObjectIdCodec.decode(await mongoObjectIdCodec.encode(hex))).toBe(hex);
  });
});

describe('mongoStringCodec', () => {
  it('round-trips string values', async () => {
    const value = 'hello world';
    expect(await mongoStringCodec.decode(value)).toBe(value);
    expect(await mongoStringCodec.encode(value)).toBe(value);
  });
});

describe('mongoInt32Codec', () => {
  it('round-trips number values', async () => {
    expect(await mongoInt32Codec.decode(42)).toBe(42);
    expect(await mongoInt32Codec.encode(42)).toBe(42);
  });
});

describe('mongoDoubleCodec', () => {
  it('round-trips floating-point number values', async () => {
    expect(await mongoDoubleCodec.decode(42.5)).toBe(42.5);
    expect(await mongoDoubleCodec.encode(42.5)).toBe(42.5);
  });

  it('has id mongo/double@1', () => {
    expect(mongoDoubleCodec.id).toBe(MONGO_DOUBLE_CODEC_ID);
  });
});

describe('mongoBooleanCodec', () => {
  it('round-trips boolean values', async () => {
    expect(await mongoBooleanCodec.decode(true)).toBe(true);
    expect(await mongoBooleanCodec.encode(false)).toBe(false);
  });
});

describe('mongoDateCodec', () => {
  it('round-trips Date values', async () => {
    const date = new Date('2024-01-15T10:30:00Z');
    expect(await mongoDateCodec.decode(date)).toBe(date);
    expect(await mongoDateCodec.encode(date)).toBe(date);
  });
});

describe('codec traits', () => {
  it('objectId has equality trait', () => {
    expect(mongoObjectIdCodec.traits).toEqual(['equality']);
  });

  it('string has equality, order, textual traits', () => {
    expect(mongoStringCodec.traits).toEqual(['equality', 'order', 'textual']);
  });

  it('int32 has equality, order, numeric traits', () => {
    expect(mongoInt32Codec.traits).toEqual(['equality', 'order', 'numeric']);
  });

  it('double has equality, order, numeric traits', () => {
    expect(mongoDoubleCodec.traits).toEqual(['equality', 'order', 'numeric']);
  });

  it('boolean has equality, boolean traits', () => {
    expect(mongoBooleanCodec.traits).toEqual(['equality', 'boolean']);
  });

  it('date has equality, order traits', () => {
    expect(mongoDateCodec.traits).toEqual(['equality', 'order']);
  });

  it('vector has equality trait', () => {
    expect(mongoVectorCodec.traits).toEqual(['equality']);
  });
});

describe('mongoVectorCodec', () => {
  it('round-trips number array values', async () => {
    const vec = [1.0, 2.5, 3.7];
    expect(await mongoVectorCodec.decode(vec)).toBe(vec);
    expect(await mongoVectorCodec.encode(vec)).toBe(vec);
  });

  it('has id mongo/vector@1', () => {
    expect(mongoVectorCodec.id).toBe(MONGO_VECTOR_CODEC_ID);
  });
});

describe('mongoDateCodec', () => {
  it('decodes wire Date through identity', async () => {
    const d = new Date('2024-01-02T03:04:05.000Z');
    expect(await mongoDateCodec.decode(d)).toBe(d);
  });

  it('encodes Date through identity', async () => {
    const d = new Date('2024-01-02T03:04:05.000Z');
    expect(await mongoDateCodec.encode(d)).toBe(d);
  });

  it('encodeJson serialises to ISO string', () => {
    const d = new Date('2024-01-02T03:04:05.000Z');
    expect(mongoDateCodec.encodeJson(d)).toBe('2024-01-02T03:04:05.000Z');
  });

  it('decodeJson parses ISO string back to Date', () => {
    const result = mongoDateCodec.decodeJson('2024-01-02T03:04:05.000Z');
    expect(result).toBeInstanceOf(Date);
    expect(result.toISOString()).toBe('2024-01-02T03:04:05.000Z');
  });

  it('decodeJson throws on non-string input', () => {
    expect(() => mongoDateCodec.decodeJson(123 as unknown as string)).toThrow(
      'expected ISO date string',
    );
  });
});

describe('mongoVectorCodec.renderOutputType', () => {
  it('renders Vector<length> when length is present', () => {
    expect(mongoVectorCodec.renderOutputType!({ length: 1536 })).toBe('Vector<1536>');
  });

  it('renders Vector<length> with small dimension', () => {
    expect(mongoVectorCodec.renderOutputType!({ length: 3 })).toBe('Vector<3>');
  });

  it('returns undefined when length is absent', () => {
    expect(mongoVectorCodec.renderOutputType!({})).toBeUndefined();
  });

  it('throws on NaN length', () => {
    expect(() => mongoVectorCodec.renderOutputType!({ length: Number.NaN })).toThrow(
      /expected positive integer "length"/,
    );
  });

  it('throws on non-integer length', () => {
    expect(() => mongoVectorCodec.renderOutputType!({ length: 3.5 })).toThrow(
      /expected positive integer "length"/,
    );
  });
});

describe('vector operation descriptors (production-defined)', () => {
  it('mongoVectorNearOperation has method near', () => {
    expect(mongoVectorNearOperation.method).toBe('near');
    expect(mongoVectorNearOperation.self?.codecId).toBe(MONGO_VECTOR_CODEC_ID);
  });

  it('mongoVectorNearOperation.impl returns undefined as a placeholder', () => {
    // Mongo does not yet lower the vector `near` operation; the impl is a
    // placeholder so the descriptor satisfies the shared shape.
    expect((mongoVectorNearOperation.impl as () => unknown)()).toBeUndefined();
  });

  it('mongoVectorOperationDescriptors includes near', () => {
    expect(mongoVectorOperationDescriptors).toHaveLength(1);
    expect(mongoVectorOperationDescriptors[0]).toBe(mongoVectorNearOperation);
  });

  it('registers production-defined operations in registry', () => {
    const registry = createOperationRegistry();
    for (const op of mongoVectorOperationDescriptors) {
      registry.register(op);
    }

    const entries = registry.entries();
    expect(entries['near']).toBeDefined();
    expect(entries['near']?.self?.codecId).toBe(MONGO_VECTOR_CODEC_ID);
  });

  it('returns empty entries for fresh registry', () => {
    const registry = createOperationRegistry();
    expect(Object.keys(registry.entries())).toHaveLength(0);
  });
});
