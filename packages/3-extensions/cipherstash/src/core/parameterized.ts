/**
 * `RuntimeParameterizedCodecDescriptor` for the cipherstash storage
 * codec. Mirrors pgvector's post-#402 shape: a static metadata block
 * (`codecId`, `traits`, `targetTypes`, `paramsSchema`,
 * `renderOutputType`) plus a curried higher-order `factory` that the
 * runtime calls once per `storage.types` instance to resolve a codec
 * for that instance.
 *
 * Cipherstash differs from pgvector in one respect: the codec depends
 * on the SDK (read-side single-cell `decrypt`, the bulk-encrypt
 * middleware in M2.c). Each `cipherstashRuntime({ sdk })` call must
 * therefore produce its own descriptor list closed over its SDK so
 * multi-tenant deployments can side-by-side multiple cipherstash
 * extensions without cross-talk. We expose
 * `createParameterizedCodecDescriptors(sdk)` for that purpose; the
 * static `paramsSchema` and `renderOutputType` slots are reusable
 * across SDK bindings.
 */

import type { CodecInstanceContext } from '@prisma-next/framework-components/codec';
import type { RuntimeParameterizedCodecDescriptor } from '@prisma-next/sql-runtime';
import { type as arktype } from 'arktype';
import { CIPHERSTASH_STRING_CODEC_ID, createCipherstashStringCodec } from './codecs';
import type { CipherstashSdk } from './sdk';

export interface CipherstashStringParams {
  readonly equality: boolean;
  readonly freeTextSearch: boolean;
}

export const encryptedStringParamsSchema = arktype({
  equality: 'boolean',
  freeTextSearch: 'boolean',
});

export function renderEncryptedStringOutputType(_params: CipherstashStringParams): string {
  return 'EncryptedString';
}

export function createParameterizedCodecDescriptors(
  sdk: CipherstashSdk,
): ReadonlyArray<RuntimeParameterizedCodecDescriptor<CipherstashStringParams>> {
  // The codec is per-cell stateless across `(equality, freeTextSearch)`
  // params on the write side (encode reads ciphertext from the handle,
  // independent of the search-mode flags). The factory therefore
  // returns the same shared codec for every params instance, mirroring
  // pgvector's `vectorFactory` precedent. When future search-mode
  // wiring needs per-instance state (e.g. decode-time index gating),
  // the closure is the place to add it.
  const sharedCodec = createCipherstashStringCodec(sdk);
  const factory = (_params: CipherstashStringParams) => (_ctx: CodecInstanceContext) => sharedCodec;
  return [
    {
      codecId: CIPHERSTASH_STRING_CODEC_ID,
      traits: ['equality'] as const,
      targetTypes: ['eql_v2_encrypted'] as const,
      paramsSchema: encryptedStringParamsSchema,
      renderOutputType: renderEncryptedStringOutputType,
      factory,
    },
  ] as const satisfies ReadonlyArray<RuntimeParameterizedCodecDescriptor<CipherstashStringParams>>;
}
