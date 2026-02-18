import { type as arktype } from 'arktype';
import { codec, defineCodecs } from './codec-types';

export const SQL_CHAR_CODEC_ID = 'sql/char@1' as const;
export const SQL_VARCHAR_CODEC_ID = 'sql/varchar@1' as const;
export const SQL_INT_CODEC_ID = 'sql/int@1' as const;
export const SQL_FLOAT_CODEC_ID = 'sql/float@1' as const;

const lengthParamsSchema = arktype({
  length: 'number.integer > 0',
});

type LengthTypeHelper = {
  readonly kind: 'fixed' | 'variable';
  readonly maxLength: number;
};

function createLengthTypeHelper(
  kind: LengthTypeHelper['kind'],
): (params: Record<string, unknown>) => LengthTypeHelper {
  return (params) => ({
    kind,
    maxLength: params['length'] as number,
  });
}

const sqlCharCodec = codec<typeof SQL_CHAR_CODEC_ID, string, string>({
  typeId: SQL_CHAR_CODEC_ID,
  targetTypes: ['char'],
  encode: (value: string): string => value,
  decode: (wire: string): string => wire.trimEnd(),
  paramsSchema: lengthParamsSchema,
  init: createLengthTypeHelper('fixed'),
});

const sqlVarcharCodec = codec<typeof SQL_VARCHAR_CODEC_ID, string, string>({
  typeId: SQL_VARCHAR_CODEC_ID,
  targetTypes: ['varchar'],
  encode: (value: string): string => value,
  decode: (wire: string): string => wire,
  paramsSchema: lengthParamsSchema,
  init: createLengthTypeHelper('variable'),
});

const sqlIntCodec = codec<typeof SQL_INT_CODEC_ID, number, number>({
  typeId: SQL_INT_CODEC_ID,
  targetTypes: ['int'],
  encode: (value) => value,
  decode: (wire) => wire,
});

const sqlFloatCodec = codec<typeof SQL_FLOAT_CODEC_ID, number, number>({
  typeId: SQL_FLOAT_CODEC_ID,
  targetTypes: ['float'],
  encode: (value) => value,
  decode: (wire) => wire,
});

const codecs = defineCodecs()
  .add('char', sqlCharCodec)
  .add('varchar', sqlVarcharCodec)
  .add('int', sqlIntCodec)
  .add('float', sqlFloatCodec);

export const sqlCodecDefinitions = codecs.codecDefinitions;
export const sqlDataTypes = codecs.dataTypes;
export type SqlCodecTypes = typeof codecs.CodecTypes;
