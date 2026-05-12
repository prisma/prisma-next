/**
 * `RuntimeParameterizedCodecDescriptor`s for the cipherstash storage
 * codecs — the post-#402 unified `CodecDescriptor<P>` shape consumed by
 * the SQL runtime via `SqlStaticContributions.parameterizedCodecs()`.
 *
 * Mirrors pgvector's `vectorParamsSchema` + `vectorFactory` precedent
 * (`packages/3-extensions/pgvector/src/exports/runtime.ts`). Cipherstash
 * differs from pgvector in two respects: each codec depends on the
 * SDK (read-side single-cell `decrypt`, the bulk-encrypt middleware),
 * so each `createParameterizedCodecDescriptors(sdk)` call produces a
 * fresh descriptor list closed over the SDK so multi-tenant
 * deployments can compose multiple cipherstash extensions side-by-side
 * without cross-talk; and the cipherstash family ships multiple
 * codecs (one per encrypted column type) which all share the same
 * `eql_v2_encrypted` Postgres native type.
 *
 * The string codec uses `{ equality, freeTextSearch }`; the numeric
 * codecs (double / bigint) use `{ equality, orderAndRange }`. Both
 * shapes default every flag to `true` per spec FR6 — searchable
 * encryption is the legitimate default for an extension whose entire
 * reason for existing is to make encrypted columns queryable.
 *
 * The codec runtimes are per-cell stateless across params on the write
 * side (encode reads ciphertext from the handle, independent of the
 * search-mode flags); read-side decode constructs the per-type
 * envelope independent of params. The factory therefore returns the
 * same shared codec for every params instance, mirroring pgvector's
 * `vectorFactory`.
 */

import type { CodecInstanceContext } from '@prisma-next/framework-components/codec';
import type { RuntimeParameterizedCodecDescriptor } from '@prisma-next/sql-runtime';
import { type as arktype } from 'arktype';
import {
  CIPHERSTASH_BIGINT_CODEC_ID,
  CIPHERSTASH_DOUBLE_CODEC_ID,
  CIPHERSTASH_STRING_CODEC_ID,
} from '../extension-metadata/constants';
import {
  createCipherstashBigIntCodec,
  createCipherstashDoubleCodec,
  createCipherstashStringCodec,
} from './codec-runtime';
import type { CipherstashSdk } from './sdk';

export interface CipherstashStringParams {
  readonly equality: boolean;
  readonly freeTextSearch: boolean;
}

export interface CipherstashNumericParams {
  readonly equality: boolean;
  readonly orderAndRange: boolean;
}

export const encryptedStringParamsSchema = arktype({
  equality: 'boolean',
  freeTextSearch: 'boolean',
});

export const encryptedDoubleParamsSchema = arktype({
  equality: 'boolean',
  orderAndRange: 'boolean',
});

export const encryptedBigIntParamsSchema = arktype({
  equality: 'boolean',
  orderAndRange: 'boolean',
});

export function renderEncryptedStringOutputType(_params: CipherstashStringParams): string {
  return 'EncryptedString';
}

export function renderEncryptedDoubleOutputType(_params: CipherstashNumericParams): string {
  return 'EncryptedDouble';
}

export function renderEncryptedBigIntOutputType(_params: CipherstashNumericParams): string {
  return 'EncryptedBigInt';
}

const ENCRYPTED_TARGET_TYPES = ['eql_v2_encrypted'] as const;
const ENCRYPTED_META = { db: { sql: { postgres: { nativeType: 'eql_v2_encrypted' } } } } as const;
// Empty traits — equality search on cipherstash columns goes through
// the cipherstash-namespaced operator (`cipherstashEq`), not the
// framework's trait-gated built-in `eq`. See
// `./cell-codec-factory.ts` for the full rationale.
const ENCRYPTED_TRAITS = [] as const;

export type CipherstashAnyParams = CipherstashStringParams | CipherstashNumericParams;

export function createParameterizedCodecDescriptors(
  sdk: CipherstashSdk,
): ReadonlyArray<RuntimeParameterizedCodecDescriptor<CipherstashAnyParams>> {
  const stringCodec = createCipherstashStringCodec(sdk);
  const doubleCodec = createCipherstashDoubleCodec(sdk);
  const bigIntCodec = createCipherstashBigIntCodec(sdk);

  const stringDescriptor: RuntimeParameterizedCodecDescriptor<CipherstashStringParams> = {
    codecId: CIPHERSTASH_STRING_CODEC_ID,
    traits: ENCRYPTED_TRAITS,
    targetTypes: ENCRYPTED_TARGET_TYPES,
    meta: ENCRYPTED_META,
    paramsSchema: encryptedStringParamsSchema,
    isParameterized: true as const,
    renderOutputType: renderEncryptedStringOutputType,
    factory: (_params: CipherstashStringParams) => (_ctx: CodecInstanceContext) => stringCodec,
  };

  const doubleDescriptor: RuntimeParameterizedCodecDescriptor<CipherstashNumericParams> = {
    codecId: CIPHERSTASH_DOUBLE_CODEC_ID,
    traits: ENCRYPTED_TRAITS,
    targetTypes: ENCRYPTED_TARGET_TYPES,
    meta: ENCRYPTED_META,
    paramsSchema: encryptedDoubleParamsSchema,
    isParameterized: true as const,
    renderOutputType: renderEncryptedDoubleOutputType,
    factory: (_params: CipherstashNumericParams) => (_ctx: CodecInstanceContext) => doubleCodec,
  };

  const bigIntDescriptor: RuntimeParameterizedCodecDescriptor<CipherstashNumericParams> = {
    codecId: CIPHERSTASH_BIGINT_CODEC_ID,
    traits: ENCRYPTED_TRAITS,
    targetTypes: ENCRYPTED_TARGET_TYPES,
    meta: ENCRYPTED_META,
    paramsSchema: encryptedBigIntParamsSchema,
    isParameterized: true as const,
    renderOutputType: renderEncryptedBigIntOutputType,
    factory: (_params: CipherstashNumericParams) => (_ctx: CodecInstanceContext) => bigIntCodec,
  };

  return [stringDescriptor, doubleDescriptor, bigIntDescriptor] as ReadonlyArray<
    RuntimeParameterizedCodecDescriptor<CipherstashAnyParams>
  >;
}
