/**
 * Runtime factory for the legacy serialized JSON / JSONB typeParams shape
 * (`{ schemaJson, type? }`).
 *
 * Pre-M3 contracts and pre-M4 user code authored JSON columns via
 * `json(schema)` / `jsonb(schema)` (see `../exports/column-types.ts`), which
 * serialized the schema into the contract IR as `{ schemaJson: <json schema>,
 * type?: <ts source> }`. The runtime descriptor at `../exports/runtime.ts`
 * registers this factory under `pg/json@1` / `pg/jsonb@1` so contract-load
 * materializes a per-instance codec carrying the compiled JSON-schema
 * `validate` function — `sql-runtime`'s validator registry reads it directly
 * off the resolved codec.
 *
 * Lives next to the M3 schema-typed `json-factory.ts` (which uses the modern
 * `{ schema }` typeParams shape with a live Standard Schema). The two paths
 * coexist: the column-author surface threads either factory onto the
 * descriptor's `type` slot for the no-emit `FieldOutputType` resolver; the
 * runtime descriptor below covers the emit-side rehydration.
 *
 * Codec-model-unification project, M4 cleanup F05.
 */

import type { Codec, Ctx } from '@prisma-next/framework-components/codec';
import { type as arktype } from 'arktype';
import { PG_JSON_CODEC_ID, PG_JSONB_CODEC_ID } from '../core/codec-ids';
import {
  compileJsonSchemaValidator,
  type JsonSchemaValidateFn,
} from '../core/json-schema-validator';

/**
 * Codec instance returned by the runtime JSON / JSONB factory. Carries the
 * per-instance compiled JSON-schema validator so `sql-runtime`'s validator
 * registry can read it directly off the resolved codec.
 */
export type JsonCodecInstance = Codec & { readonly validate: JsonSchemaValidateFn };

/** Compiled JSON-schema validator carrier. Exported as a public alias for
 * downstream consumers that previously imported `JsonCodecHelper`. */
export type JsonCodecHelper = { readonly validate: JsonSchemaValidateFn };

export const jsonRuntimeParamsSchema = arktype({
  schemaJson: 'object',
  'type?': 'string',
});

export type JsonRuntimeParams = typeof jsonRuntimeParamsSchema.infer;

function buildJsonRuntimeFactory(
  codecId: typeof PG_JSON_CODEC_ID | typeof PG_JSONB_CODEC_ID,
  nativeType: 'json' | 'jsonb',
): (params: JsonRuntimeParams) => (ctx: Ctx) => JsonCodecInstance {
  return (params) => {
    const validate = compileJsonSchemaValidator(params.schemaJson as Record<string, unknown>);
    return (_ctx) => ({
      id: codecId,
      targetTypes: [nativeType],
      // The `'json-validator'` trait is the M4-F06 gate that lets sql-runtime'"'"'s
      // `extractValidator` resolve `validate` as a typed field rather than via
      // an unknown cast.
      traits: ['json-validator'] as const,
      decode: (wire: unknown) => wire,
      encodeJson: (value) => value as never,
      decodeJson: (json) => json as never,
      validate,
    });
  };
}

export const pgJsonRuntimeFactory = buildJsonRuntimeFactory(PG_JSON_CODEC_ID, 'json');
export const pgJsonbRuntimeFactory = buildJsonRuntimeFactory(PG_JSONB_CODEC_ID, 'jsonb');
