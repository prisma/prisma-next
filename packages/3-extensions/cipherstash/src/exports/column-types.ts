/**
 * TS contract factory for cipherstash-encrypted string columns.
 *
 * Counterpart to the PSL constructor `cipherstash.EncryptedString({...})`
 * registered in `core/authoring.ts`. Both factories produce the same
 * `ColumnTypeDescriptor` shape so PSL- and TS-authored contracts emit
 * byte-identical `contract.json`. See `DEVELOPING.md` § Forthcoming
 * surface for the rest of the in-progress milestones.
 */

import { CIPHERSTASH_STRING_CODEC_ID, CIPHERSTASH_STRING_TARGET_TYPE } from '../core/codecs';

/**
 * Search-mode parameters for `encryptedString({...})`. Both flags are
 * optional and default to `false` when omitted; storage-only encryption
 * is the legitimate default per the project's M2 standing decision.
 */
export interface EncryptedStringOptions {
  readonly equality?: boolean;
  readonly freeTextSearch?: boolean;
}

export interface EncryptedStringColumnDescriptor {
  readonly codecId: typeof CIPHERSTASH_STRING_CODEC_ID;
  readonly nativeType: typeof CIPHERSTASH_STRING_TARGET_TYPE;
  readonly typeParams: {
    readonly equality: boolean;
    readonly freeTextSearch: boolean;
  };
}

/**
 * `encryptedString({ equality?, freeTextSearch? })` — TS contract
 * factory that lowers to a `ColumnTypeDescriptor` with the
 * `cipherstash/string@1` codec and the `eql_v2_encrypted` Postgres
 * native type. The two boolean flags become `typeParams.equality`
 * and `typeParams.freeTextSearch`.
 *
 * The shape matches what the PSL constructor
 * `cipherstash.EncryptedString({...})` lowers to, byte-for-byte; the
 * authoring parity fixture under
 * `test/integration/test/authoring/parity/cipherstash-encrypted-string/`
 * pins this equivalence.
 */
export function encryptedString(options: EncryptedStringOptions): EncryptedStringColumnDescriptor {
  return {
    codecId: CIPHERSTASH_STRING_CODEC_ID,
    nativeType: CIPHERSTASH_STRING_TARGET_TYPE,
    typeParams: {
      equality: options.equality ?? false,
      freeTextSearch: options.freeTextSearch ?? false,
    },
  };
}
