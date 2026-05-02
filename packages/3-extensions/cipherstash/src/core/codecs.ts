/**
 * Cipherstash storage codec — wraps the `EncryptedString` envelope at
 * the SQL codec boundary.
 *
 * The codec is intentionally thin:
 *
 * - `decode(wire, ctx)` constructs a fresh envelope carrying the wire
 *   ciphertext + the cell's `(table, column)` from `ctx.column` + the
 *   SDK reference captured by the codec factory at construction time.
 *   The envelope's `decrypt({signal?})` later routes through the
 *   captured SDK; callers can also `await decryptAll(rows)` (M4) to
 *   coalesce decrypts across many envelopes into one bulk SDK call.
 *
 * - `encode(envelope, ctx)` extracts the ciphertext from the envelope's
 *   handle. The bulk-encrypt middleware (M2.c) populates the
 *   ciphertext slot before the codec runs; an envelope whose
 *   ciphertext slot is empty at encode time is a programmer error
 *   (the middleware was not registered, or this codec instance was
 *   used in a non-cipherstash context).
 */

import type { Codec, SqlCodecCallContext } from '@prisma-next/sql-relational-core/ast';
import { codec } from '@prisma-next/sql-relational-core/ast';
import { EncryptedString, getInternalHandle } from './envelope';
import type { CipherstashSdk } from './sdk';

export const CIPHERSTASH_STRING_CODEC_ID = 'cipherstash/string@1' as const;

export const CIPHERSTASH_STRING_TARGET_TYPE = 'eql_v2_encrypted' as const;

const CIPHERSTASH_STRING_TRAITS = ['equality'] as const;

/**
 * SDK-free codec used in pack-meta (`cipherstashPackMeta.types.codecTypes
 * .codecInstances`). The framework's lookup machinery only reads codec
 * *metadata* (`typeId`, `targetTypes`, `traits`, `renderOutputType`) from
 * pack-meta codec instances; encode/decode never fire on a pack-meta
 * codec because the SQL runtime always resolves codecs through the
 * SDK-bound runtime descriptor instead.
 *
 * Encode/decode throw with a clear message in the misuse case so it's
 * obvious the runtime descriptor wasn't wired up.
 */
export const cipherstashStringCodecMetadata = codec({
  typeId: CIPHERSTASH_STRING_CODEC_ID,
  targetTypes: [CIPHERSTASH_STRING_TARGET_TYPE],
  traits: CIPHERSTASH_STRING_TRAITS,
  renderOutputType: () => 'EncryptedString',
  encode: () => {
    throw new Error(
      'cipherstash codec: encode called on the pack-meta metadata codec. ' +
        'Construct a runtime descriptor with `createCipherstashRuntimeDescriptor({ sdk })` and use that instead.',
    );
  },
  decode: () => {
    throw new Error(
      'cipherstash codec: decode called on the pack-meta metadata codec. ' +
        'Construct a runtime descriptor with `createCipherstashRuntimeDescriptor({ sdk })` and use that instead.',
    );
  },
  encodeJson: (value) => {
    void value;
    return { $encryptedString: '<opaque>' };
  },
  decodeJson: () => {
    throw new Error(
      'cipherstash codec: decodeJson is not supported; envelopes do not round-trip through JSON.',
    );
  },
  meta: {
    db: {
      sql: {
        postgres: {
          nativeType: CIPHERSTASH_STRING_TARGET_TYPE,
        },
      },
    },
  },
});

/**
 * Construct the cipherstash storage codec, capturing the `sdk`
 * reference for read-side single-cell decrypts.
 *
 * The codec is recreated per runtime extension descriptor instance —
 * each `cipherstashRuntime({ sdk })` call (added in M2.b/M2.c with the
 * full extension wiring) produces a codec closed over its own SDK so
 * multi-tenant deployments can construct one extension per tenant
 * without cross-talk.
 */
export function createCipherstashStringCodec(
  sdk: CipherstashSdk,
): Codec<
  typeof CIPHERSTASH_STRING_CODEC_ID,
  typeof CIPHERSTASH_STRING_TRAITS,
  unknown,
  EncryptedString
> {
  return codec({
    typeId: CIPHERSTASH_STRING_CODEC_ID,
    targetTypes: [CIPHERSTASH_STRING_TARGET_TYPE],
    traits: CIPHERSTASH_STRING_TRAITS,
    renderOutputType: () => 'EncryptedString',
    encode: (envelope: EncryptedString, _ctx: SqlCodecCallContext): unknown => {
      const handle = getInternalHandle(envelope);
      if (handle.ciphertext === undefined) {
        throw new Error(
          'cipherstash codec: envelope has no ciphertext at encode time. ' +
            'Register the bulk-encrypt middleware in the runtime so envelopes are encrypted before encoding.',
        );
      }
      return handle.ciphertext;
    },
    decode: (wire: unknown, ctx: SqlCodecCallContext): EncryptedString => {
      const column = ctx.column;
      if (!column) {
        throw new Error(
          'cipherstash codec: decode requires ctx.column to construct a routing-aware envelope. ' +
            'The SQL runtime populates `ctx.column` for projected columns; aggregate/computed cells are not supported by this codec.',
        );
      }
      return EncryptedString.fromInternal({
        ciphertext: wire,
        table: column.table,
        column: column.name,
        sdk,
      });
    },
    encodeJson: (value) => {
      void value;
      return { $encryptedString: '<opaque>' };
    },
    decodeJson: () => {
      throw new Error(
        'cipherstash codec: decodeJson is not supported; envelopes do not round-trip through JSON.',
      );
    },
    meta: {
      db: {
        sql: {
          postgres: {
            nativeType: CIPHERSTASH_STRING_TARGET_TYPE,
          },
        },
      },
    },
  });
}
