import type { JsonValue } from '@prisma-next/contract/types';
import { type as arktype } from 'arktype';
import { defineCodec, defineCodecBundle, defineCodecGroup, mkCodec } from './codec-types';

export const SQL_CHAR_CODEC_ID = 'sql/char@1' as const;
export const SQL_VARCHAR_CODEC_ID = 'sql/varchar@1' as const;
export const SQL_INT_CODEC_ID = 'sql/int@1' as const;
export const SQL_FLOAT_CODEC_ID = 'sql/float@1' as const;
export const SQL_TEXT_CODEC_ID = 'sql/text@1' as const;
export const SQL_TIMESTAMP_CODEC_ID = 'sql/timestamp@1' as const;

const lengthParamsSchema = arktype({
  length: 'number.integer > 0',
});

const precisionParamsSchema = arktype({
  'precision?': 'number.integer >= 0 & number.integer <= 6',
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

// ---------------------------------------------------------------------------
// Author surface: encode/decode/render extracted to module-level constants so
// the legacy `mkCodec()` form and the `defineCodec()` sibling form share a
// single source of truth for runtime behaviour. The legacy codec form is
// retained transitionally for consumers that still read codec instances out
// of `sqlCodecDefinitions[k].codec`; the descriptor sibling is the M2 target
// shape (TML-2357 T2.2). Both forms delete down to just the descriptor in
// the M2 cleanup commit.
// ---------------------------------------------------------------------------

export const sqlCharEncode = (value: string): string => value;
export const sqlCharDecode = (wire: string): string => wire.trimEnd();
export const sqlCharRenderOutputType = (typeParams: { readonly length?: number }) => {
  const length = typeParams.length;
  if (length === undefined) return undefined;
  if (typeof length !== 'number' || !Number.isFinite(length) || !Number.isInteger(length)) {
    throw new Error(
      `renderOutputType: expected integer "length" in typeParams for Char, got ${String(length)}`,
    );
  }
  return `Char<${length}>`;
};

export const sqlVarcharEncode = (value: string): string => value;
export const sqlVarcharDecode = (wire: string): string => wire;
export const sqlVarcharRenderOutputType = (typeParams: { readonly length?: number }) => {
  const length = typeParams.length;
  if (length === undefined) return undefined;
  if (typeof length !== 'number' || !Number.isFinite(length) || !Number.isInteger(length)) {
    throw new Error(
      `renderOutputType: expected integer "length" in typeParams for Varchar, got ${String(length)}`,
    );
  }
  return `Varchar<${length}>`;
};

export const sqlIntEncode = (value: number): number => value;
export const sqlIntDecode = (wire: number): number => wire;

export const sqlFloatEncode = (value: number): number => value;
export const sqlFloatDecode = (wire: number): number => wire;

export const sqlTextEncode = (value: string): string => value;
export const sqlTextDecode = (wire: string): string => wire;

export const sqlTimestampEncode = (value: Date): Date => value;
export const sqlTimestampDecode = (wire: Date): Date => wire;
export const sqlTimestampEncodeJson = (value: Date): JsonValue => value.toISOString();
export const sqlTimestampDecodeJson = (json: JsonValue): Date => {
  if (typeof json !== 'string') {
    throw new Error(`Expected ISO date string for sql/timestamp@1, got ${typeof json}`);
  }
  const date = new Date(json);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid ISO date string for sql/timestamp@1: ${json}`);
  }
  return date;
};
export const sqlTimestampRenderOutputType = (typeParams: { readonly precision?: number }) => {
  const precision = typeParams.precision;
  if (precision === undefined) {
    return 'Timestamp';
  }
  if (
    typeof precision !== 'number' ||
    !Number.isFinite(precision) ||
    !Number.isInteger(precision)
  ) {
    throw new Error(
      `renderOutputType: expected integer "precision" in typeParams for Timestamp, got ${String(precision)}`,
    );
  }
  return `Timestamp<${precision}>`;
};

// ---------------------------------------------------------------------------
// Legacy codec instances. Retained transitionally for consumers that still
// read `sqlCodecDefinitions[k].codec` (postgres + sqlite target codecs.ts,
// sql-codecs.test.ts). Deleted in the M2 cleanup commit alongside the
// `mkCodec()` factory and `defineCodecGroup()` builder.
// ---------------------------------------------------------------------------

const sqlCharCodec = mkCodec<
  typeof SQL_CHAR_CODEC_ID,
  readonly ['equality', 'order', 'textual'],
  string,
  string
>({
  typeId: SQL_CHAR_CODEC_ID,
  targetTypes: ['char'],
  traits: ['equality', 'order', 'textual'],
  encode: sqlCharEncode,
  decode: sqlCharDecode,
  paramsSchema: lengthParamsSchema,
  init: createLengthTypeHelper('fixed'),
  renderOutputType: (typeParams) => sqlCharRenderOutputType(typeParams as { length?: number }),
});

const sqlVarcharCodec = mkCodec<
  typeof SQL_VARCHAR_CODEC_ID,
  readonly ['equality', 'order', 'textual'],
  string,
  string
>({
  typeId: SQL_VARCHAR_CODEC_ID,
  targetTypes: ['varchar'],
  traits: ['equality', 'order', 'textual'],
  encode: sqlVarcharEncode,
  decode: sqlVarcharDecode,
  paramsSchema: lengthParamsSchema,
  init: createLengthTypeHelper('variable'),
  renderOutputType: (typeParams) => sqlVarcharRenderOutputType(typeParams as { length?: number }),
});

const sqlIntCodec = mkCodec({
  typeId: SQL_INT_CODEC_ID,
  targetTypes: ['int'],
  traits: ['equality', 'order', 'numeric'],
  encode: sqlIntEncode,
  decode: sqlIntDecode,
});

const sqlFloatCodec = mkCodec({
  typeId: SQL_FLOAT_CODEC_ID,
  targetTypes: ['float'],
  traits: ['equality', 'order', 'numeric'],
  encode: sqlFloatEncode,
  decode: sqlFloatDecode,
});

const sqlTextCodec = mkCodec({
  typeId: SQL_TEXT_CODEC_ID,
  targetTypes: ['text'],
  traits: ['equality', 'order', 'textual'],
  encode: sqlTextEncode,
  decode: sqlTextDecode,
});

const sqlTimestampCodec = mkCodec<
  typeof SQL_TIMESTAMP_CODEC_ID,
  readonly ['equality', 'order'],
  Date,
  Date
>({
  typeId: SQL_TIMESTAMP_CODEC_ID,
  targetTypes: ['timestamp'],
  traits: ['equality', 'order'],
  encode: sqlTimestampEncode,
  decode: sqlTimestampDecode,
  encodeJson: sqlTimestampEncodeJson,
  decodeJson: sqlTimestampDecodeJson,
  paramsSchema: precisionParamsSchema,
  renderOutputType: (typeParams) =>
    sqlTimestampRenderOutputType(typeParams as { precision?: number }),
});

const codecs = defineCodecGroup()
  .add('char', sqlCharCodec)
  .add('varchar', sqlVarcharCodec)
  .add('int', sqlIntCodec)
  .add('float', sqlFloatCodec)
  .add('text', sqlTextCodec)
  .add('timestamp', sqlTimestampCodec);

export const sqlCodecDefinitions = codecs.byScalar;
export const sqlDataTypes = codecs.dataTypes;
export type SqlCodecTypes = typeof codecs.CodecTypes;

// ---------------------------------------------------------------------------
// Native descriptor exports (TML-2357 T2.2). These are the M2 target shape:
// every contributor ships `CodecDescriptor`s through the unified `codecs:`
// slot. Per-package migrations (postgres T2.3, sqlite T2.4, etc.) consume
// these descriptors. The legacy codec exports above delete in the M2 cleanup
// commit once every consumer has migrated.
// ---------------------------------------------------------------------------

export const sqlCharDescriptor = defineCodec<
  typeof SQL_CHAR_CODEC_ID,
  readonly ['equality', 'order', 'textual'],
  string,
  string,
  { readonly length?: number }
>({
  codecId: SQL_CHAR_CODEC_ID,
  targetTypes: ['char'],
  traits: ['equality', 'order', 'textual'],
  encode: sqlCharEncode,
  decode: sqlCharDecode,
  paramsSchema: lengthParamsSchema,
  renderOutputType: sqlCharRenderOutputType,
});

export const sqlVarcharDescriptor = defineCodec<
  typeof SQL_VARCHAR_CODEC_ID,
  readonly ['equality', 'order', 'textual'],
  string,
  string,
  { readonly length?: number }
>({
  codecId: SQL_VARCHAR_CODEC_ID,
  targetTypes: ['varchar'],
  traits: ['equality', 'order', 'textual'],
  encode: sqlVarcharEncode,
  decode: sqlVarcharDecode,
  paramsSchema: lengthParamsSchema,
  renderOutputType: sqlVarcharRenderOutputType,
});

export const sqlIntDescriptor = defineCodec<
  typeof SQL_INT_CODEC_ID,
  readonly ['equality', 'order', 'numeric'],
  number,
  number
>({
  codecId: SQL_INT_CODEC_ID,
  targetTypes: ['int'],
  traits: ['equality', 'order', 'numeric'],
  encode: sqlIntEncode,
  decode: sqlIntDecode,
});

export const sqlFloatDescriptor = defineCodec<
  typeof SQL_FLOAT_CODEC_ID,
  readonly ['equality', 'order', 'numeric'],
  number,
  number
>({
  codecId: SQL_FLOAT_CODEC_ID,
  targetTypes: ['float'],
  traits: ['equality', 'order', 'numeric'],
  encode: sqlFloatEncode,
  decode: sqlFloatDecode,
});

export const sqlTextDescriptor = defineCodec<
  typeof SQL_TEXT_CODEC_ID,
  readonly ['equality', 'order', 'textual'],
  string,
  string
>({
  codecId: SQL_TEXT_CODEC_ID,
  targetTypes: ['text'],
  traits: ['equality', 'order', 'textual'],
  encode: sqlTextEncode,
  decode: sqlTextDecode,
});

export const sqlTimestampDescriptor = defineCodec<
  typeof SQL_TIMESTAMP_CODEC_ID,
  readonly ['equality', 'order'],
  Date,
  Date,
  { readonly precision?: number }
>({
  codecId: SQL_TIMESTAMP_CODEC_ID,
  targetTypes: ['timestamp'],
  traits: ['equality', 'order'],
  encode: sqlTimestampEncode,
  decode: sqlTimestampDecode,
  encodeJson: sqlTimestampEncodeJson,
  decodeJson: sqlTimestampDecodeJson,
  paramsSchema: precisionParamsSchema,
  renderOutputType: sqlTimestampRenderOutputType,
});

const sqlDescriptors = defineCodecBundle()
  .add('char', sqlCharDescriptor)
  .add('varchar', sqlVarcharDescriptor)
  .add('int', sqlIntDescriptor)
  .add('float', sqlFloatDescriptor)
  .add('text', sqlTextDescriptor)
  .add('timestamp', sqlTimestampDescriptor);

/**
 * Descriptor view of the SQL base codecs, keyed by scalar name. Mirrors
 * {@link sqlCodecDefinitions} for the descriptor shape (TML-2357 M2).
 */
export const sqlCodecDescriptorDefinitions = sqlDescriptors.byScalar;

/**
 * Flat array of every SQL base codec descriptor — ready to feed into a
 * contributor's unified `codecs:` slot.
 */
export const sqlCodecDescriptorList = sqlDescriptors.descriptors;
