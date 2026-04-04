import { createOperationRegistry } from '@prisma-next/operations';
import { ObjectId } from 'mongodb';
import { describe, expect, it } from 'vitest';
import { MONGO_VECTOR_CODEC_ID } from '../src/core/codec-ids';
import {
  mongoBooleanCodec,
  mongoDateCodec,
  mongoInt32Codec,
  mongoObjectIdCodec,
  mongoStringCodec,
  mongoVectorCodec,
} from '../src/core/codecs';
import { mongoVectorNearOperation, mongoVectorOperationSignatures } from '../src/core/operations';

describe('mongoObjectIdCodec', () => {
  it('decodes ObjectId to hex string', () => {
    const oid = new ObjectId('507f1f77bcf86cd799439011');
    expect(mongoObjectIdCodec.decode(oid)).toBe('507f1f77bcf86cd799439011');
  });

  it('encodes hex string to ObjectId', () => {
    const result = mongoObjectIdCodec.encode!('507f1f77bcf86cd799439011');
    expect(result).toBeInstanceOf(ObjectId);
    expect(result.toHexString()).toBe('507f1f77bcf86cd799439011');
  });

  it('round-trips: decode(encode(hex)) === hex', () => {
    const hex = '65a1b2c3d4e5f6a7b8c9d0e1';
    expect(mongoObjectIdCodec.decode(mongoObjectIdCodec.encode!(hex))).toBe(hex);
  });
});

describe('mongoStringCodec', () => {
  it('round-trips string values', () => {
    const value = 'hello world';
    expect(mongoStringCodec.decode(value)).toBe(value);
    expect(mongoStringCodec.encode!(value)).toBe(value);
  });
});

describe('mongoInt32Codec', () => {
  it('round-trips number values', () => {
    expect(mongoInt32Codec.decode(42)).toBe(42);
    expect(mongoInt32Codec.encode!(42)).toBe(42);
  });
});

describe('mongoBooleanCodec', () => {
  it('round-trips boolean values', () => {
    expect(mongoBooleanCodec.decode(true)).toBe(true);
    expect(mongoBooleanCodec.encode!(false)).toBe(false);
  });
});

describe('mongoDateCodec', () => {
  it('round-trips Date values', () => {
    const date = new Date('2024-01-15T10:30:00Z');
    expect(mongoDateCodec.decode(date)).toBe(date);
    expect(mongoDateCodec.encode!(date)).toBe(date);
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

  it('boolean has equality, boolean traits', () => {
    expect(mongoBooleanCodec.traits).toEqual(['equality', 'boolean']);
  });

  it('date has equality, order traits', () => {
    expect(mongoDateCodec.traits).toEqual(['equality', 'order']);
  });

  it('vector has equality and vector traits', () => {
    expect(mongoVectorCodec.traits).toEqual(['equality', 'vector']);
  });
});

describe('mongoVectorCodec', () => {
  it('round-trips number array values', () => {
    const vec = [1.0, 2.5, 3.7];
    expect(mongoVectorCodec.decode(vec)).toBe(vec);
    expect(mongoVectorCodec.encode!(vec)).toBe(vec);
  });

  it('has id mongo/vector@1', () => {
    expect(mongoVectorCodec.id).toBe('mongo/vector@1');
  });
});

describe('vector operation signatures (production-defined)', () => {
  it('mongoVectorNearOperation targets mongo/vector@1', () => {
    expect(mongoVectorNearOperation.forTypeId).toBe(MONGO_VECTOR_CODEC_ID);
    expect(mongoVectorNearOperation.method).toBe('near');
  });

  it('mongoVectorOperationSignatures includes near', () => {
    expect(mongoVectorOperationSignatures).toHaveLength(1);
    expect(mongoVectorOperationSignatures[0]).toBe(mongoVectorNearOperation);
  });

  it('registers production-defined operations in registry', () => {
    const registry = createOperationRegistry();
    for (const op of mongoVectorOperationSignatures) {
      registry.register(op);
    }

    const ops = registry.byType(MONGO_VECTOR_CODEC_ID);
    expect(ops).toHaveLength(1);
    expect(ops[0]?.method).toBe('near');
  });

  it('returns no operations for types without registered extensions', () => {
    const registry = createOperationRegistry();
    for (const op of mongoVectorOperationSignatures) {
      registry.register(op);
    }

    expect(registry.byType('mongo/string@1')).toHaveLength(0);
  });
});
