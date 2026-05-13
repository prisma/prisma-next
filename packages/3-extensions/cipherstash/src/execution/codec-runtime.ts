/**
 * Cipherstash storage codec runtimes — wrap each `Encrypted*` envelope
 * at the SQL codec boundary.
 *
 * Every cipherstash codec has identical encode/decode bodies (the
 * `eql_v2_encrypted` composite-literal wire format is determined by
 * the EQL type definition, not by the plaintext type). The shared body
 * lives in `./cell-codec-factory.ts`; the per-codec wrappers below
 * supply only the per-type discriminators (codec id, user-facing type
 * name, envelope `fromInternal` factory) and re-export the codec class
 * for backwards compatibility with consumers that imported it directly
 * from this module.
 *
 * Mirrors the `makeCipherstashCodecHooks` pattern on the migration
 * plane (see `../migration/codec-hooks-factory.ts`) — same shape,
 * opposite plane.
 *
 * Equality search on cipherstash columns intentionally goes through the
 * cipherstash-namespaced operator (`cipherstashEq`); the framework's
 * trait-gated built-in `eq` would lower to standard SQL `=` which is
 * wrong for EQL ciphers (randomized nonces). Each codec therefore
 * declares no traits — see `./cell-codec-factory.ts`.
 */

import {
  CIPHERSTASH_BIGINT_CODEC_ID,
  CIPHERSTASH_BOOLEAN_CODEC_ID,
  CIPHERSTASH_DATE_CODEC_ID,
  CIPHERSTASH_DOUBLE_CODEC_ID,
  CIPHERSTASH_JSON_CODEC_ID,
  CIPHERSTASH_STRING_CODEC_ID,
} from '../extension-metadata/constants';
import { CipherstashCellCodec, makeCipherstashCellCodec } from './cell-codec-factory';
import { EncryptedBigInt } from './envelope-bigint';
import { EncryptedBoolean } from './envelope-boolean';
import { EncryptedDate } from './envelope-date';
import { EncryptedDouble } from './envelope-double';
import { EncryptedJson } from './envelope-json';
import { EncryptedString } from './envelope-string';
import type { CipherstashSdk } from './sdk';

export { CIPHERSTASH_STRING_CODEC_ID };

/** @deprecated Re-exported for source compatibility; new call sites should use `CipherstashCellCodec`. */
export type CipherstashStringCodec = CipherstashCellCodec<EncryptedString>;

export function createCipherstashStringCodec(
  sdk: CipherstashSdk,
): CipherstashCellCodec<EncryptedString> {
  return makeCipherstashCellCodec(sdk, {
    codecId: CIPHERSTASH_STRING_CODEC_ID,
    typeName: 'EncryptedString',
    fromInternal: EncryptedString.fromInternal,
  });
}

export function createCipherstashDoubleCodec(
  sdk: CipherstashSdk,
): CipherstashCellCodec<EncryptedDouble> {
  return makeCipherstashCellCodec(sdk, {
    codecId: CIPHERSTASH_DOUBLE_CODEC_ID,
    typeName: 'EncryptedDouble',
    fromInternal: EncryptedDouble.fromInternal,
  });
}

export function createCipherstashBigIntCodec(
  sdk: CipherstashSdk,
): CipherstashCellCodec<EncryptedBigInt> {
  return makeCipherstashCellCodec(sdk, {
    codecId: CIPHERSTASH_BIGINT_CODEC_ID,
    typeName: 'EncryptedBigInt',
    fromInternal: EncryptedBigInt.fromInternal,
  });
}

export function createCipherstashDateCodec(
  sdk: CipherstashSdk,
): CipherstashCellCodec<EncryptedDate> {
  return makeCipherstashCellCodec(sdk, {
    codecId: CIPHERSTASH_DATE_CODEC_ID,
    typeName: 'EncryptedDate',
    fromInternal: EncryptedDate.fromInternal,
  });
}

export function createCipherstashBooleanCodec(
  sdk: CipherstashSdk,
): CipherstashCellCodec<EncryptedBoolean> {
  return makeCipherstashCellCodec(sdk, {
    codecId: CIPHERSTASH_BOOLEAN_CODEC_ID,
    typeName: 'EncryptedBoolean',
    fromInternal: EncryptedBoolean.fromInternal,
  });
}

export function createCipherstashJsonCodec(
  sdk: CipherstashSdk,
): CipherstashCellCodec<EncryptedJson> {
  return makeCipherstashCellCodec(sdk, {
    codecId: CIPHERSTASH_JSON_CODEC_ID,
    typeName: 'EncryptedJson',
    fromInternal: EncryptedJson.fromInternal,
  });
}

export { CipherstashCellCodec };
