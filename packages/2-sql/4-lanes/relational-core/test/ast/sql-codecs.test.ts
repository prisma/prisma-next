import { describe, expect, it } from 'vitest';
import {
  SQL_CHAR_CODEC_ID,
  SQL_FLOAT_CODEC_ID,
  SQL_INT_CODEC_ID,
  SQL_TEXT_CODEC_ID,
  SQL_TIMESTAMP_CODEC_ID,
  SQL_VARCHAR_CODEC_ID,
  sqlCodecDefinitions,
  sqlDataTypes,
} from '../../src/ast/sql-codecs';

describe('sql-codecs', () => {
  it('exports expected codec IDs', () => {
    expect({
      char: SQL_CHAR_CODEC_ID,
      varchar: SQL_VARCHAR_CODEC_ID,
      int: SQL_INT_CODEC_ID,
      float: SQL_FLOAT_CODEC_ID,
      text: SQL_TEXT_CODEC_ID,
      timestamp: SQL_TIMESTAMP_CODEC_ID,
    }).toEqual({
      char: 'sql/char@1',
      varchar: 'sql/varchar@1',
      int: 'sql/int@1',
      float: 'sql/float@1',
      text: 'sql/text@1',
      timestamp: 'sql/timestamp@1',
    });
  });

  const codecDefinitionCases: ReadonlyArray<{
    scalar: keyof typeof sqlCodecDefinitions;
    id: string;
    targetTypes: readonly string[];
  }> = [
    { scalar: 'char', id: SQL_CHAR_CODEC_ID, targetTypes: ['char'] },
    { scalar: 'varchar', id: SQL_VARCHAR_CODEC_ID, targetTypes: ['varchar'] },
    { scalar: 'int', id: SQL_INT_CODEC_ID, targetTypes: ['int'] },
    { scalar: 'float', id: SQL_FLOAT_CODEC_ID, targetTypes: ['float'] },
    { scalar: 'text', id: SQL_TEXT_CODEC_ID, targetTypes: ['text'] },
    { scalar: 'timestamp', id: SQL_TIMESTAMP_CODEC_ID, targetTypes: ['timestamp'] },
  ];

  it.each(codecDefinitionCases)('defines codec for $scalar', ({ scalar, id, targetTypes }) => {
    const definition = sqlCodecDefinitions[scalar];
    expect(definition.typeId).toBe(id);
    expect(definition.scalar).toBe(scalar);
    expect(definition.codec.targetTypes).toEqual(targetTypes);
  });

  it('exports data types mapped to codec IDs', () => {
    expect(sqlDataTypes).toEqual({
      char: SQL_CHAR_CODEC_ID,
      varchar: SQL_VARCHAR_CODEC_ID,
      int: SQL_INT_CODEC_ID,
      float: SQL_FLOAT_CODEC_ID,
      text: SQL_TEXT_CODEC_ID,
      timestamp: SQL_TIMESTAMP_CODEC_ID,
    });
  });

  const codecRoundTripCases: ReadonlyArray<{
    scalar: keyof typeof sqlCodecDefinitions;
    input: string | number;
    expectedEncoded: string | number;
    expectedDecoded: string | number;
  }> = [
    {
      scalar: 'char',
      input: 'A',
      expectedEncoded: 'A',
      expectedDecoded: 'A',
    },
    {
      scalar: 'varchar',
      input: 'hello',
      expectedEncoded: 'hello',
      expectedDecoded: 'hello',
    },
    {
      scalar: 'int',
      input: 42,
      expectedEncoded: 42,
      expectedDecoded: 42,
    },
    {
      scalar: 'float',
      input: 3.14,
      expectedEncoded: 3.14,
      expectedDecoded: 3.14,
    },
    {
      scalar: 'text',
      input: 'portable text',
      expectedEncoded: 'portable text',
      expectedDecoded: 'portable text',
    },
    {
      scalar: 'timestamp',
      input: '2024-01-15T10:30:00.000Z',
      expectedEncoded: '2024-01-15T10:30:00.000Z',
      expectedDecoded: '2024-01-15T10:30:00.000Z',
    },
  ];

  it.each(codecRoundTripCases)('encodes and decodes $scalar values', ({
    scalar,
    input,
    expectedEncoded,
    expectedDecoded,
  }) => {
    const codec = sqlCodecDefinitions[scalar].codec as {
      encode: (value: unknown) => unknown;
      decode: (wire: unknown) => unknown;
    };

    expect(codec.encode(input)).toBe(expectedEncoded);
    expect(codec.decode(input)).toBe(expectedDecoded);
  });

  it('trims trailing spaces when decoding char values', () => {
    const charCodec = sqlCodecDefinitions.char.codec as {
      decode: (wire: string) => string;
    };

    expect(charCodec.decode('user_001                            ')).toBe('user_001');
    expect(charCodec.decode('user_001')).toBe('user_001');
  });

  it('normalizes Date values for timestamp codecs', () => {
    const timestampCodec = sqlCodecDefinitions.timestamp.codec as {
      encode: (value: string | Date) => string;
      decode: (wire: string | Date) => string;
    };

    const instant = new Date('2024-01-15T10:30:00Z');

    expect(timestampCodec.encode(instant)).toBe('2024-01-15T10:30:00.000Z');
    expect(timestampCodec.decode(instant)).toBe('2024-01-15T10:30:00.000Z');
  });

  // M4 cleanup F01: `renderOutputType` was retired from the SQL `Codec`
  // extension. Per-codec renderer assertions migrated to descriptor-level
  // tests at `packages/3-targets/6-adapters/postgres/test/codec-render-output-type.test.ts`
  // (where the descriptors live).
});
