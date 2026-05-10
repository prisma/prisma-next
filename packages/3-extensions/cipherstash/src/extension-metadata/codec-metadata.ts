/**
 * SDK-free codec used in pack-meta (`cipherstashPackMeta.types.codecTypes
 * .codecInstances`). Pack-meta consumers only read codec *metadata*
 * (`typeId`, `targetTypes`, `traits`, `renderOutputType`) at contract
 * emit time — they never call `encode`/`decode`.
 *
 * The SDK-bound runtime codec for actual `encode`/`decode` lives in
 * `../execution/codec-runtime`; it is resolved through
 * `RuntimeParameterizedCodecDescriptor.factory` at runtime instead of
 * through pack-meta's `codecInstances`.
 *
 * Keeping the SDK-free metadata in its own module — and *not* importing
 * the runtime `CipherstashStringCodec` class — preserves the control
 * vs runtime split. Control-plane consumers (`exports/control.ts`,
 * `exports/pack.ts`) pull this file but never touch the envelope, the
 * SDK interface, or the bulk-encrypt middleware. The bundling-isolation
 * test pins this property by snapshotting that the control entry's
 * chunk graph does not transitively load `envelope-*.mjs`.
 *
 * `encode`/`decode` throw with a clear hint in the misuse case so
 * accidental wiring of the metadata codec into a real runtime path
 * surfaces immediately instead of silently no-op'ing.
 */

import type { JsonValue } from '@prisma-next/contract/types';
import { type AnyCodecDescriptor, CodecImpl } from '@prisma-next/framework-components/codec';
import { CIPHERSTASH_STRING_CODEC_ID, EQL_V2_ENCRYPTED_TYPE } from './constants';

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

class CipherstashStringCodecMetadata extends CodecImpl<
  typeof CIPHERSTASH_STRING_CODEC_ID,
  readonly [],
  unknown,
  unknown
> {
  async encode(): Promise<unknown> {
    throw new Error(
      'cipherstash codec: encode called on the pack-meta metadata codec. ' +
        'Construct a runtime descriptor via `createCipherstashRuntimeDescriptor({ sdk })` and use that instead.',
    );
  }

  async decode(): Promise<unknown> {
    throw new Error(
      'cipherstash codec: decode called on the pack-meta metadata codec. ' +
        'Construct a runtime descriptor via `createCipherstashRuntimeDescriptor({ sdk })` and use that instead.',
    );
  }

  encodeJson(): JsonValue {
    return { $encryptedString: '<opaque>' };
  }

  decodeJson(): unknown {
    throw new Error(
      'cipherstash codec: decodeJson is not supported; envelopes do not round-trip through JSON.',
    );
  }
}

export const cipherstashStringCodecMetadata = new CipherstashStringCodecMetadata(
  METADATA_DESCRIPTOR,
);
