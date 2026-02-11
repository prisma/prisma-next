/**
 * Column type descriptors for Postgres adapter.
 *
 * These descriptors provide both codecId and nativeType for use in contract authoring.
 * They are derived from the same source of truth as codec definitions and manifests.
 */

import type { ColumnTypeDescriptor } from '@prisma-next/contract-authoring';
import type { StorageTypeInstance } from '@prisma-next/sql-contract/types';
import { PG_JSON_CODEC_ID, PG_JSONB_CODEC_ID } from '../core/codec-ids';
import {
  extractStandardSchemaOutputJsonSchema,
  extractStandardSchemaTypeExpression,
  isStandardSchemaLike,
  type StandardSchemaLike,
} from '../core/standard-schema';

export const textColumn: ColumnTypeDescriptor = {
  codecId: 'pg/text@1',
  nativeType: 'text',
} as const;

export const int4Column: ColumnTypeDescriptor = {
  codecId: 'pg/int4@1',
  nativeType: 'int4',
} as const;

export const int2Column: ColumnTypeDescriptor = {
  codecId: 'pg/int2@1',
  nativeType: 'int2',
} as const;

export const int8Column: ColumnTypeDescriptor = {
  codecId: 'pg/int8@1',
  nativeType: 'int8',
} as const;

export const float4Column: ColumnTypeDescriptor = {
  codecId: 'pg/float4@1',
  nativeType: 'float4',
} as const;

export const float8Column: ColumnTypeDescriptor = {
  codecId: 'pg/float8@1',
  nativeType: 'float8',
} as const;

export const timestampColumn: ColumnTypeDescriptor = {
  codecId: 'pg/timestamp@1',
  nativeType: 'timestamp',
} as const;

export const timestamptzColumn: ColumnTypeDescriptor = {
  codecId: 'pg/timestamptz@1',
  nativeType: 'timestamptz',
} as const;

export const boolColumn: ColumnTypeDescriptor = {
  codecId: 'pg/bool@1',
  nativeType: 'bool',
} as const;

export const jsonColumn: ColumnTypeDescriptor = {
  codecId: PG_JSON_CODEC_ID,
  nativeType: 'json',
} as const;

export const jsonbColumn: ColumnTypeDescriptor = {
  codecId: PG_JSONB_CODEC_ID,
  nativeType: 'jsonb',
} as const;

type JsonSchemaTypeParams = {
  readonly schema: Record<string, unknown>;
  readonly type?: string;
};

function createJsonTypeParams(schema: StandardSchemaLike): JsonSchemaTypeParams {
  const outputSchema = extractStandardSchemaOutputJsonSchema(schema);
  if (!outputSchema) {
    throw new Error('JSON schema must expose ~standard.jsonSchema.output()');
  }

  const expression = extractStandardSchemaTypeExpression(schema);
  if (expression) {
    return { schema: outputSchema, type: expression };
  }

  return { schema: outputSchema };
}

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
    codecId: 'pg/enum@1',
    nativeType: name,
    typeParams: { values },
  } as const;
}

export function enumColumn<TypeName extends string>(
  typeName: TypeName,
  nativeType: string,
): ColumnTypeDescriptor & { readonly typeRef: TypeName } {
  return {
    codecId: 'pg/enum@1',
    nativeType,
    typeRef: typeName,
  };
}
