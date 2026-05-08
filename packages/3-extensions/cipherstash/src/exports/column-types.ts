/**
 * TS contract factory for cipherstash-encrypted string columns.
 *
 * Counterpart to the PSL constructor `cipherstash.EncryptedString({...})`
 * registered in `../core/authoring.ts`. Both factories produce the same
 * `ColumnTypeDescriptor` shape so PSL- and TS-authored contracts emit
 * byte-identical `contract.json` (verified by the parity fixture under
 * `test/integration/test/authoring/parity/cipherstash-encrypted-string/`).
 *
 * Defaults are `false`/`false` per the project's M2 standing decision:
 * storage-only encryption is the legitimate default, mirroring the PSL
 * constructor's `false` defaults declared via `AuthoringArgRef.default`.
 */

import { CIPHERSTASH_STRING_CODEC_ID, EQL_V2_ENCRYPTED_TYPE } from '../core/constants';

/**
 * Search-mode parameters for `encryptedString({...})`. Both flags are
 * optional and default to `false` when omitted.
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
 * `typeParams.freeTextSearch`.
 *
 * The shape matches what the PSL constructor
 * `cipherstash.EncryptedString({...})` lowers to, byte-for-byte.
 */
export function encryptedString(options: EncryptedStringOptions): EncryptedStringColumnDescriptor {
  return {
    codecId: CIPHERSTASH_STRING_CODEC_ID,
    nativeType: EQL_V2_ENCRYPTED_TYPE,
    typeParams: {
      equality: options.equality ?? false,
      freeTextSearch: options.freeTextSearch ?? false,
    },
  };
}
