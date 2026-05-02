import { describe, expect, it } from 'vitest';
import type { SqlCodecCallContext } from '../../src/ast/codec-types';
import {
  SQL_CHAR_CODEC_ID,
  SQL_FLOAT_CODEC_ID,
  SQL_INT_CODEC_ID,
  SQL_TEXT_CODEC_ID,
  SQL_TIMESTAMP_CODEC_ID,
  SQL_VARCHAR_CODEC_ID,
  sqlCodecDefinitions,
  sqlCodecDescriptorDefinitions,
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
    scalar: keyof typeof sqlCodecDescriptorDefinitions;
    id: string;
    targetTypes: readonly string[];
    hasParamsSchema: boolean;
  }> = [
    {
      scalar: 'char',
      id: SQL_CHAR_CODEC_ID,
      targetTypes: ['char'],
      hasParamsSchema: true,
    },
    {
      scalar: 'varchar',
      id: SQL_VARCHAR_CODEC_ID,
      targetTypes: ['varchar'],
      hasParamsSchema: true,
    },
    {
      scalar: 'int',
      id: SQL_INT_CODEC_ID,
      targetTypes: ['int'],
      hasParamsSchema: true,
    },
    {
      scalar: 'float',
      id: SQL_FLOAT_CODEC_ID,
      targetTypes: ['float'],
      hasParamsSchema: true,
    },
    {
      scalar: 'text',
      id: SQL_TEXT_CODEC_ID,
      targetTypes: ['text'],
      hasParamsSchema: true,
    },
    {
      scalar: 'timestamp',
      id: SQL_TIMESTAMP_CODEC_ID,
      targetTypes: ['timestamp'],
      hasParamsSchema: true,
    },
  ];

  it.each(codecDefinitionCases)('defines codec for $scalar', ({
    scalar,
    id,
    targetTypes,
    hasParamsSchema,
  }) => {
    const definition = sqlCodecDescriptorDefinitions[scalar];
    expect(definition.codecId).toBe(id);
    expect(definition.scalar).toBe(scalar);
    expect(definition.descriptor.targetTypes).toEqual(targetTypes);
    expect(definition.descriptor.paramsSchema !== undefined).toBe(hasParamsSchema);
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
  ];

  it.each(codecRoundTripCases)('encodes and decodes $scalar values', async ({
    scalar,
    input,
    expectedEncoded,
    expectedDecoded,
  }) => {
    const codec = sqlCodecDefinitions[scalar].codec as {
      encode: (value: unknown, ctx: SqlCodecCallContext) => Promise<unknown>;
      decode: (wire: unknown, ctx: SqlCodecCallContext) => Promise<unknown>;
    };

    expect(await codec.encode(input, {})).toBe(expectedEncoded);
    expect(await codec.decode(input, {})).toBe(expectedDecoded);
  });

  it('trims trailing spaces when decoding char values', async () => {
    const charCodec = sqlCodecDefinitions.char.codec as {
      decode: (wire: string, ctx: SqlCodecCallContext) => Promise<string>;
    };

    expect(await charCodec.decode('user_001                            ', {})).toBe('user_001');
    expect(await charCodec.decode('user_001', {})).toBe('user_001');
  });

  it('round-trips Date values for timestamp codecs', async () => {
    const timestampCodec = sqlCodecDefinitions.timestamp.codec as {
      encode: (value: Date, ctx: SqlCodecCallContext) => Promise<Date>;
      decode: (wire: Date, ctx: SqlCodecCallContext) => Promise<Date>;
    };

    const instant = new Date('2024-01-15T10:30:00Z');

    expect(await timestampCodec.encode(instant, {})).toBe(instant);
    expect(await timestampCodec.decode(instant, {})).toBe(instant);
  });

  it('serializes timestamps to ISO strings for the JSON contract', () => {
    const timestampCodec = sqlCodecDefinitions.timestamp.codec;

    const instant = new Date('2024-01-15T10:30:00Z');

    expect(timestampCodec.encodeJson(instant)).toBe('2024-01-15T10:30:00.000Z');
    expect(timestampCodec.decodeJson('2024-01-15T10:30:00.000Z')).toEqual(instant);
  });

  it('throws on invalid JSON input for timestamp codecs', () => {
    const timestampCodec = sqlCodecDefinitions.timestamp.codec;

    expect(() => timestampCodec.decodeJson(42)).toThrow(/Expected ISO date string/);
    expect(() => timestampCodec.decodeJson('not-a-date')).toThrow(/Invalid ISO date string/);
  });

  describe('renderOutputType', () => {
    it('sql/char@1 renders Char<length>', () => {
      expect(
        (sqlCodecDescriptorDefinitions.char.descriptor.renderOutputType as
          | ((p: Record<string, unknown>) => string | undefined)
          | undefined)!({ length: 36 }),
      ).toBe('Char<36>');
    });

    it('sql/char@1 returns undefined when length absent', () => {
      expect(
        (sqlCodecDescriptorDefinitions.char.descriptor.renderOutputType as
          | ((p: Record<string, unknown>) => string | undefined)
          | undefined)!({}),
      ).toBeUndefined();
    });

    it('sql/char@1 throws on invalid length type', () => {
      expect(() =>
        (sqlCodecDescriptorDefinitions.char.descriptor.renderOutputType as
          | ((p: Record<string, unknown>) => string | undefined)
          | undefined)!({ length: 'bad' }),
      ).toThrow(/expected integer "length"/);
    });

    it('sql/varchar@1 renders Varchar<length>', () => {
      expect(
        (sqlCodecDescriptorDefinitions.varchar.descriptor.renderOutputType as
          | ((p: Record<string, unknown>) => string | undefined)
          | undefined)!({ length: 255 }),
      ).toBe('Varchar<255>');
    });

    it('sql/varchar@1 returns undefined when length absent', () => {
      expect(
        (sqlCodecDescriptorDefinitions.varchar.descriptor.renderOutputType as
          | ((p: Record<string, unknown>) => string | undefined)
          | undefined)!({}),
      ).toBeUndefined();
    });

    it('sql/varchar@1 throws on invalid length type', () => {
      expect(() =>
        (sqlCodecDescriptorDefinitions.varchar.descriptor.renderOutputType as
          | ((p: Record<string, unknown>) => string | undefined)
          | undefined)!({ length: 'bad' }),
      ).toThrow(/expected integer "length"/);
    });

    it('sql/timestamp@1 renders Timestamp<P> with precision', () => {
      expect(
        (sqlCodecDescriptorDefinitions.timestamp.descriptor.renderOutputType as
          | ((p: Record<string, unknown>) => string | undefined)
          | undefined)!({ precision: 3 }),
      ).toBe('Timestamp<3>');
    });

    it('sql/timestamp@1 renders bare Timestamp when precision absent', () => {
      expect(
        (sqlCodecDescriptorDefinitions.timestamp.descriptor.renderOutputType as
          | ((p: Record<string, unknown>) => string | undefined)
          | undefined)!({}),
      ).toBe('Timestamp');
    });

    it('sql/timestamp@1 throws on invalid precision type', () => {
      expect(() =>
        (sqlCodecDescriptorDefinitions.timestamp.descriptor.renderOutputType as
          | ((p: Record<string, unknown>) => string | undefined)
          | undefined)!({ precision: 'bad' }),
      ).toThrow(/expected integer "precision"/);
    });

    it('sql/int@1 has no renderOutputType', () => {
      expect(
        sqlCodecDescriptorDefinitions.int.descriptor.renderOutputType as
          | ((p: Record<string, unknown>) => string | undefined)
          | undefined,
      ).toBeUndefined();
    });

    it('sql/float@1 has no renderOutputType', () => {
      expect(
        sqlCodecDescriptorDefinitions.float.descriptor.renderOutputType as
          | ((p: Record<string, unknown>) => string | undefined)
          | undefined,
      ).toBeUndefined();
    });

    it('sql/text@1 has no renderOutputType', () => {
      expect(
        sqlCodecDescriptorDefinitions.text.descriptor.renderOutputType as
          | ((p: Record<string, unknown>) => string | undefined)
          | undefined,
      ).toBeUndefined();
    });
  });
});
