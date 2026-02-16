/**
 * Column type descriptors for Postgres adapter.
 *
 * These descriptors provide both codecId and nativeType for use in contract authoring.
 * They are derived from the same source of truth as codec definitions and manifests.
 */

import type { ColumnTypeDescriptor } from '@prisma-next/contract-authoring';
import type { StorageTypeInstance } from '@prisma-next/sql-contract/types';
import {
  PG_BIT_CODEC_ID,
  PG_BOOL_CODEC_ID,
  PG_ENUM_CODEC_ID,
  PG_FLOAT4_CODEC_ID,
  PG_FLOAT8_CODEC_ID,
  PG_INT2_CODEC_ID,
  PG_INT4_CODEC_ID,
  PG_INT8_CODEC_ID,
  PG_INTERVAL_CODEC_ID,
  PG_JSON_CODEC_ID,
  PG_JSONB_CODEC_ID,
  PG_NUMERIC_CODEC_ID,
  PG_TEXT_CODEC_ID,
  PG_TIME_CODEC_ID,
  PG_TIMESTAMP_CODEC_ID,
  PG_TIMESTAMPTZ_CODEC_ID,
  PG_TIMETZ_CODEC_ID,
  PG_VARBIT_CODEC_ID,
  SQL_CHAR_CODEC_ID,
  SQL_VARCHAR_CODEC_ID,
} from '../core/codec-ids';
import {
  extractStandardSchemaOutputJsonSchema,
  extractStandardSchemaTypeExpression,
  isStandardSchemaLike,
  type StandardSchemaLike,
} from '../core/standard-schema';

export const textColumn: ColumnTypeDescriptor = {
  codecId: PG_TEXT_CODEC_ID,
  nativeType: 'text',
} as const;

export function charColumn(length: number): ColumnTypeDescriptor & {
  readonly typeParams: { readonly length: number };
} {
  return {
    codecId: SQL_CHAR_CODEC_ID,
    nativeType: 'character',
    typeParams: { length },
  } as const;
}

export function varcharColumn(length: number): ColumnTypeDescriptor & {
  readonly typeParams: { readonly length: number };
} {
  return {
    codecId: SQL_VARCHAR_CODEC_ID,
    nativeType: 'character varying',
    typeParams: { length },
  } as const;
}

export const int4Column: ColumnTypeDescriptor = {
  codecId: PG_INT4_CODEC_ID,
  nativeType: 'int4',
} as const;

export const int2Column: ColumnTypeDescriptor = {
  codecId: PG_INT2_CODEC_ID,
  nativeType: 'int2',
} as const;

export const int8Column: ColumnTypeDescriptor = {
  codecId: PG_INT8_CODEC_ID,
  nativeType: 'int8',
} as const;

export const float4Column: ColumnTypeDescriptor = {
  codecId: PG_FLOAT4_CODEC_ID,
  nativeType: 'float4',
} as const;

export const float8Column: ColumnTypeDescriptor = {
  codecId: PG_FLOAT8_CODEC_ID,
  nativeType: 'float8',
} as const;

export function numericColumn(
  precision: number,
  scale?: number,
): ColumnTypeDescriptor & {
  readonly typeParams: { readonly precision: number; readonly scale?: number };
} {
  return {
    codecId: PG_NUMERIC_CODEC_ID,
    nativeType: 'numeric',
    typeParams: scale === undefined ? { precision } : { precision, scale },
  } as const;
}

export const timestampColumn: ColumnTypeDescriptor = {
  codecId: PG_TIMESTAMP_CODEC_ID,
  nativeType: 'timestamp',
} as const;

export const timestamptzColumn: ColumnTypeDescriptor = {
  codecId: PG_TIMESTAMPTZ_CODEC_ID,
  nativeType: 'timestamptz',
} as const;

export function timeColumn(precision?: number): ColumnTypeDescriptor & {
  readonly typeParams?: { readonly precision: number };
} {
  return {
    codecId: PG_TIME_CODEC_ID,
    nativeType: 'time',
    ...(precision === undefined ? {} : { typeParams: { precision } }),
  } as const;
}

export function timetzColumn(precision?: number): ColumnTypeDescriptor & {
  readonly typeParams?: { readonly precision: number };
} {
  return {
    codecId: PG_TIMETZ_CODEC_ID,
    nativeType: 'timetz',
    ...(precision === undefined ? {} : { typeParams: { precision } }),
  } as const;
}

export const boolColumn: ColumnTypeDescriptor = {
  codecId: PG_BOOL_CODEC_ID,
  nativeType: 'bool',
} as const;

export function bitColumn(length: number): ColumnTypeDescriptor & {
  readonly typeParams: { readonly length: number };
} {
  return {
    codecId: PG_BIT_CODEC_ID,
    nativeType: 'bit',
    typeParams: { length },
  } as const;
}

export function varbitColumn(length: number): ColumnTypeDescriptor & {
  readonly typeParams: { readonly length: number };
} {
  return {
    codecId: PG_VARBIT_CODEC_ID,
    nativeType: 'bit varying',
    typeParams: { length },
  } as const;
}

export function intervalColumn(precision?: number): ColumnTypeDescriptor & {
  readonly typeParams?: { readonly precision: number };
} {
  return {
    codecId: PG_INTERVAL_CODEC_ID,
    nativeType: 'interval',
    ...(precision === undefined ? {} : { typeParams: { precision } }),
  } as const;
}

export const jsonColumn: ColumnTypeDescriptor = {
  codecId: PG_JSON_CODEC_ID,
  nativeType: 'json',
} as const;

export const jsonbColumn: ColumnTypeDescriptor = {
  codecId: PG_JSONB_CODEC_ID,
  nativeType: 'jsonb',
} as const;

type JsonSchemaTypeParams = {
  readonly schemaJson: Record<string, unknown>;
  readonly type?: string;
};

function createJsonTypeParams(schema: StandardSchemaLike): JsonSchemaTypeParams {
  const outputSchema = extractStandardSchemaOutputJsonSchema(schema);
  if (!outputSchema) {
    throw new Error('JSON schema must expose ~standard.jsonSchema.output()');
  }

  const expression = extractStandardSchemaTypeExpression(schema);
  if (expression) {
    return { schemaJson: outputSchema, type: expression };
  }

  return { schemaJson: outputSchema };
}

/**
 * Typed column descriptor for JSON/JSONB columns with Standard Schema.
 *
 * `typeParams.schemaJson` carries the runtime JSON Schema payload (serializable record)
 * used by the emitter to render TypeScript type expressions in contract.d.ts.
 *
 * `typeParams.schema` is a phantom-only key: at runtime it does not exist, but at the
 * type level it preserves the original `TSchema` so that `ResolveStandardSchemaOutput<P>`
 * in codec-types.ts can resolve the output type via `~standard.types.output` or `.infer`.
 */
type TypedColumnDescriptor<TSchema extends StandardSchemaLike> = ColumnTypeDescriptor & {
  readonly typeParams: JsonSchemaTypeParams & { readonly schema: TSchema };
};

function createJsonColumnFactory(
  codecId: string,
  nativeType: string,
  staticDescriptor: ColumnTypeDescriptor,
) {
  return <TSchema extends StandardSchemaLike>(schema?: TSchema): ColumnTypeDescriptor => {
    if (!schema) {
      return staticDescriptor;
    }

    if (!isStandardSchemaLike(schema)) {
      throw new Error(`${nativeType}(schema) expects a Standard Schema value`);
    }

    return {
      codecId,
      nativeType,
      // At runtime, typeParams only contains { schemaJson, type? }.
      // The `schema` key exists only at the type level (phantom) so that
      // `ResolveStandardSchemaOutput<P>` in codec-types.ts can resolve the
      // schema's output type via `~standard.types.output` or `.infer`.
      typeParams: createJsonTypeParams(schema) as JsonSchemaTypeParams & {
        readonly schema: TSchema;
      },
    };
  };
}

const _json = createJsonColumnFactory(PG_JSON_CODEC_ID, 'json', jsonColumn);
const _jsonb = createJsonColumnFactory(PG_JSONB_CODEC_ID, 'jsonb', jsonbColumn);

export function json(): ColumnTypeDescriptor;
export function json<TSchema extends StandardSchemaLike>(
  schema: TSchema,
): TypedColumnDescriptor<TSchema>;
export function json<TSchema extends StandardSchemaLike>(schema?: TSchema): ColumnTypeDescriptor {
  return _json(schema);
}

export function jsonb(): ColumnTypeDescriptor;
export function jsonb<TSchema extends StandardSchemaLike>(
  schema: TSchema,
): TypedColumnDescriptor<TSchema>;
export function jsonb<TSchema extends StandardSchemaLike>(schema?: TSchema): ColumnTypeDescriptor {
  return _jsonb(schema);
}

export function enumType<const Values extends readonly string[]>(
  name: string,
  values: Values,
): StorageTypeInstance & { readonly typeParams: { readonly values: Values } } {
  return {
    codecId: PG_ENUM_CODEC_ID,
    nativeType: name,
    typeParams: { values },
  } as const;
}

export function enumColumn<TypeName extends string>(
  typeName: TypeName,
  nativeType: string,
): ColumnTypeDescriptor & { readonly typeRef: TypeName } {
  return {
    codecId: PG_ENUM_CODEC_ID,
    nativeType,
    typeRef: typeName,
  };
}
