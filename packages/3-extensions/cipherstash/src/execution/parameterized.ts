/**
 * `RuntimeParameterizedCodecDescriptor` for the cipherstash storage
 * codec — the post-#402 unified `CodecDescriptor<P>` shape consumed by
 * the SQL runtime via `SqlStaticContributions.parameterizedCodecs()`.
 *
 * Mirrors pgvector's `vectorParamsSchema` + `vectorFactory` precedent
 * (`packages/3-extensions/pgvector/src/exports/runtime.ts`). Cipherstash
 * differs from pgvector in one respect: the codec depends on the SDK
 * (read-side single-cell `decrypt`, the bulk-encrypt middleware), so
 * each `createParameterizedCodecDescriptors(sdk)` call produces its
 * own descriptor list closed over its SDK so multi-tenant
 * deployments can side-by-side multiple cipherstash extensions without
 * cross-talk.
 *
 * The factory is per-cell stateless across `(equality, freeTextSearch)`
 * params on the write side (encode reads ciphertext from the handle,
 * independent of the search-mode flags) — search-mode flags only affect
 * operator lowering and the codec lifecycle hook on the control plane.
 * The factory therefore returns the same shared codec
 * for every params instance, mirroring pgvector's `vectorFactory`. When
 * future per-instance state (e.g. decode-time index gating) lands, the
 * closure is the place to add it.
 */

import type { CodecInstanceContext } from '@prisma-next/framework-components/codec';
import type { RuntimeParameterizedCodecDescriptor } from '@prisma-next/sql-runtime';
import { type as arktype } from 'arktype';
import { CIPHERSTASH_STRING_CODEC_ID, createCipherstashStringCodec } from './codec-runtime';
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
  const sharedCodec = createCipherstashStringCodec(sdk);
  const factory = (_params: CipherstashStringParams) => (_ctx: CodecInstanceContext) => sharedCodec;
  return [
    {
      codecId: CIPHERSTASH_STRING_CODEC_ID,
      // Empty traits — equality search on cipherstash columns goes
      // through the cipherstash-namespaced operator (`cipherstashEq`
      // in `./operators.ts`), not the framework`s trait-gated built-in
      // `eq`. See `./codec-runtime.ts` for the full rationale.
      traits: [] as const,
      targetTypes: ['eql_v2_encrypted'] as const,
      // Postgres native-type metadata. The SQL renderer reads this off
      // the descriptor via `codecLookup.metaFor(codecId)` to insert the
      // `$N::eql_v2_encrypted` cast on bound params (the EQL composite
      // type isn`t inferrable from a `text` literal, so the cast is
      // load-bearing).
      meta: { db: { sql: { postgres: { nativeType: 'eql_v2_encrypted' } } } },
      paramsSchema: encryptedStringParamsSchema,
      isParameterized: true as const,
      renderOutputType: renderEncryptedStringOutputType,
      factory,
    },
  ] as const satisfies ReadonlyArray<RuntimeParameterizedCodecDescriptor<CipherstashStringParams>>;
}
