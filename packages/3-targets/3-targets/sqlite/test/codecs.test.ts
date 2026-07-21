import { describe, expect, it } from 'vitest';
import { sqliteBigintDescriptor } from '../src/core/codecs';

describe('SQLite codec JSON representations', () => {
  const bigintCodec = sqliteBigintDescriptor.factory()({ name: 'test' });

  it('uses SQLite JSON numbers for bigint values', () => {
    expect(bigintCodec.encodeJson(42n)).toBe(42);
    expect(bigintCodec.decodeJson(42)).toBe(42n);
  });

  it('rejects the old string contract representation', () => {
    expect(() => bigintCodec.decodeJson('42')).toThrow(
      'sqlite/bigint@1 database JSON value must be a number',
    );
  });
});
