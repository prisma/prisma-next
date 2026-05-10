/**
 * SDK-free codec used in pack-meta (`cipherstashPackMeta.types.codecTypes
 * .codecInstances`). Pack-meta consumers only read codec *metadata*
 * (`typeId`, `targetTypes`, `traits`, `renderOutputType`) at contract
 * emit time — they never call `encode`/`decode`.
 *
 * The SDK-bound runtime codec for actual `encode`/`decode` lives in
 * `./codec-runtime` (see `createCipherstashStringCodec(sdk)`); it is
 * resolved through `RuntimeParameterizedCodecDescriptor.factory` at
 * runtime instead of through pack-meta's `codecInstances`.
 *
 * Keeping the SDK-free metadata in its own module preserves the control
 * vs runtime split: control-plane consumers (`exports/control.ts`,
 * `exports/pack.ts`) pull this file but never touch the envelope, the
 * SDK interface, or the bulk-encrypt middleware.
 *
 * `encode`/`decode` throw with a clear hint in the misuse case so
 * accidental wiring of the metadata codec into a real runtime path
 * surfaces immediately instead of silently no-op'ing.
 */

import type { AnyCodecDescriptor } from '@prisma-next/framework-components/codec';
import { CipherstashStringCodec } from '../execution/codec-runtime';
import { CIPHERSTASH_STRING_CODEC_ID, EQL_V2_ENCRYPTED_TYPE } from './constants';

// Empty traits — cipherstash columns expose equality search via the
// cipherstash-namespaced operator surface (`cipherstashEq` /
// `cipherstashIlike` in `./operators.ts`), not via the framework`s
// trait-gated built-in `eq`. See `./codec-runtime.ts` for the full
// rationale; the metadata codec mirrors the runtime codec`s trait
// declaration so contract emit (which reads pack-meta) and runtime
// (which reads the parameterized descriptor) agree.
/**
 * SDK-free metadata codec for pack consumers. The `CipherstashStringCodec`
 * class is the same shape used at runtime; passing `undefined` for the SDK
 * causes `decode` to throw with a clear "metadata-only" diagnostic, while
 * `id` / `targetTypes` / `traits` / `meta` (read off the descriptor passed
 * to the constructor) remain available for emit-time inspection.
 */
const METADATA_DESCRIPTOR: AnyCodecDescriptor = {
  codecId: CIPHERSTASH_STRING_CODEC_ID,
  traits: [],
  targetTypes: [EQL_V2_ENCRYPTED_TYPE],
  meta: { db: { sql: { postgres: { nativeType: EQL_V2_ENCRYPTED_TYPE } } } },
  paramsSchema: {
    '~standard': {
      version: 1,
      vendor: 'cipherstash',
      validate: (value: unknown) => ({ value }),
    },
  },
  isParameterized: false,
  renderOutputType: () => 'EncryptedString',
  factory: () => () => {
    throw new Error('cipherstash codec: metadata descriptor factory is not callable');
  },
};

export const cipherstashStringCodecMetadata = new CipherstashStringCodec(
  METADATA_DESCRIPTOR,
  undefined,
);
