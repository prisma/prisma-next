/**
 * TS contract factory for cipherstash-encrypted string columns.
 *
 * Counterpart to the PSL constructor `cipherstash.EncryptedString({...})`
 * registered in `../contract-authoring`. Both factories produce the same
 * `ColumnTypeDescriptor` shape so PSL- and TS-authored contracts emit
 * byte-identical `contract.json` (verified by the parity fixture under
 * `test/integration/test/authoring/parity/cipherstash-encrypted-string/`).
 *
 * Both flags default to `true` — searchable encryption is the
 * legitimate default for an extension whose entire reason for existing
 * is to make encrypted columns queryable. Users who want storage-only
 * encryption opt out explicitly: `encryptedString({ equality: false,
 * freeTextSearch: false })`. Mirrors the PSL constructor's `true`
 * defaults declared via `AuthoringArgRef.default`.
 */

import {
  CIPHERSTASH_STRING_CODEC_ID,
  EQL_V2_ENCRYPTED_TYPE,
} from '../extension-metadata/constants';

/**
 * Search-mode parameters for `encryptedString({...})`. Both flags are
 * optional and default to `true` when omitted.
 */
export interface EncryptedStringOptions {
  readonly equality?: boolean;
  readonly freeTextSearch?: boolean;
}

export interface EncryptedStringColumnDescriptor {
  readonly codecId: typeof CIPHERSTASH_STRING_CODEC_ID;
  readonly nativeType: typeof EQL_V2_ENCRYPTED_TYPE;
  readonly typeParams: {
    readonly equality: boolean;
    readonly freeTextSearch: boolean;
  };
}

/**
 * `encryptedString({ equality?, freeTextSearch? })` — TS contract
 * factory that lowers to a `ColumnTypeDescriptor` with the
 * `cipherstash/string@1` codec and the `eql_v2_encrypted` Postgres
 * native type. The two boolean flags become `typeParams.equality` and
 * `typeParams.freeTextSearch`. Both default to `true`.
 *
 * The shape matches what the PSL constructor
 * `cipherstash.EncryptedString({...})` lowers to, byte-for-byte.
 */
export function encryptedString(
  options: EncryptedStringOptions = {},
): EncryptedStringColumnDescriptor {
  return {
    codecId: CIPHERSTASH_STRING_CODEC_ID,
    nativeType: EQL_V2_ENCRYPTED_TYPE,
    typeParams: {
      equality: options.equality ?? true,
      freeTextSearch: options.freeTextSearch ?? true,
    },
  };
}
