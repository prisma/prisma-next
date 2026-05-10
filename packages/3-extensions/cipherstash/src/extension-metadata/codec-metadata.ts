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

import { codec } from '@prisma-next/sql-relational-core/ast';
import { CIPHERSTASH_STRING_CODEC_ID, EQL_V2_ENCRYPTED_TYPE } from './constants';

// Empty traits — cipherstash columns expose equality search via the
// cipherstash-namespaced operator surface (`cipherstashEq` /
// `cipherstashIlike` in `./operators.ts`), not via the framework`s
// trait-gated built-in `eq`. See `./codec-runtime.ts` for the full
// rationale; the metadata codec mirrors the runtime codec`s trait
// declaration so contract emit (which reads pack-meta) and runtime
// (which reads the parameterized descriptor) agree.
const CIPHERSTASH_STRING_TRAITS = [] as const;

export const cipherstashStringCodecMetadata = codec({
  typeId: CIPHERSTASH_STRING_CODEC_ID,
  targetTypes: [EQL_V2_ENCRYPTED_TYPE],
  traits: CIPHERSTASH_STRING_TRAITS,
  renderOutputType: () => 'EncryptedString',
  encode: () => {
    throw new Error(
      'cipherstash codec: encode called on the pack-meta metadata codec. ' +
        'Construct a runtime descriptor via the cipherstash runtime entry point and use that instead.',
    );
  },
  decode: () => {
    throw new Error(
      'cipherstash codec: decode called on the pack-meta metadata codec. ' +
        'Construct a runtime descriptor via the cipherstash runtime entry point and use that instead.',
    );
  },
  encodeJson: () => ({ $encryptedString: '<opaque>' }),
  decodeJson: () => {
    throw new Error(
      'cipherstash codec: decodeJson is not supported; envelopes do not round-trip through JSON.',
    );
  },
  meta: {
    db: {
      sql: {
        postgres: {
          nativeType: EQL_V2_ENCRYPTED_TYPE,
        },
      },
    },
  },
});
