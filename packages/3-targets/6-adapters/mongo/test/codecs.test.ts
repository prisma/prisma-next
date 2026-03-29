import { ObjectId } from 'mongodb';
import { describe, expect, it } from 'vitest';
import {
  mongoBooleanCodec,
  mongoDateCodec,
  mongoInt32Codec,
  mongoObjectIdCodec,
  mongoStringCodec,
} from '../src/core/codecs';

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
