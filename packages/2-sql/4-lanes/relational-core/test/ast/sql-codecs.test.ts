import { describe, expect, it } from 'vitest';
import {
  SQL_CHAR_CODEC_ID,
  SQL_FLOAT_CODEC_ID,
  SQL_INT_CODEC_ID,
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
    }).toEqual({
      char: 'sql/char@1',
      varchar: 'sql/varchar@1',
      int: 'sql/int@1',
      float: 'sql/float@1',
    });
  });

  const codecDefinitionCases: ReadonlyArray<{
    scalar: keyof typeof sqlCodecDefinitions;
    id: string;
    targetTypes: readonly string[];
    hasParamsSchema: boolean;
    hasInit: boolean;
  }> = [
    {
      scalar: 'char',
      id: SQL_CHAR_CODEC_ID,
      targetTypes: ['char'],
      hasParamsSchema: true,
      hasInit: true,
    },
    {
      scalar: 'varchar',
      id: SQL_VARCHAR_CODEC_ID,
      targetTypes: ['varchar'],
      hasParamsSchema: true,
      hasInit: true,
    },
    {
      scalar: 'int',
      id: SQL_INT_CODEC_ID,
      targetTypes: ['int'],
      hasParamsSchema: false,
      hasInit: false,
    },
    {
      scalar: 'float',
      id: SQL_FLOAT_CODEC_ID,
      targetTypes: ['float'],
      hasParamsSchema: false,
      hasInit: false,
    },
  ];

  it.each(codecDefinitionCases)('defines codec for $scalar', ({
    scalar,
    id,
    targetTypes,
    hasParamsSchema,
    hasInit,
  }) => {
    const definition = sqlCodecDefinitions[scalar];
    expect(definition.typeId).toBe(id);
    expect(definition.scalar).toBe(scalar);
    expect(definition.codec.targetTypes).toEqual(targetTypes);
    expect(definition.codec.paramsSchema !== undefined).toBe(hasParamsSchema);
    expect(definition.codec.init !== undefined).toBe(hasInit);
  });

  it('exports data types mapped to codec IDs', () => {
    expect(sqlDataTypes).toEqual({
      char: SQL_CHAR_CODEC_ID,
      varchar: SQL_VARCHAR_CODEC_ID,
      int: SQL_INT_CODEC_ID,
      float: SQL_FLOAT_CODEC_ID,
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

  it('initializes helpers for length-parameterized codecs', () => {
    const charCodec = sqlCodecDefinitions.char.codec;
    const varcharCodec = sqlCodecDefinitions.varchar.codec;

    expect(charCodec.init?.({ length: 5 })).toEqual({
      kind: 'fixed',
      maxLength: 5,
    });
    expect(varcharCodec.init?.({ length: 255 })).toEqual({
      kind: 'variable',
      maxLength: 255,
    });
  });
});
