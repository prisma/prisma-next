/**
 * TS contract factories for cipherstash-encrypted columns.
 *
 * Counterparts to the PSL constructors `cipherstash.Encrypted<Type>({...})`
 * registered in `../contract-authoring`. The six factories
 * (`encryptedString`, `encryptedDouble`, `encryptedBigInt`,
 * `encryptedDate`, `encryptedBoolean`, `encryptedJson`) produce the
 * same `ColumnTypeDescriptor` shape as their PSL counterparts, so
 * PSL- and TS-authored contracts emit byte-identical `contract.json`.
 * Pinned by the parity fixtures at
 * `test/integration/test/authoring/parity/cipherstash-encrypted-{string,double,bigint,date,boolean,json}/`.
 *
 * Every search-mode flag defaults to `true` — searchable encryption
 * is the legitimate default for an extension whose entire reason for
 * existing is to make encrypted columns queryable. Users who want
 * storage-only encryption opt out explicitly:
 * `encryptedString({ equality: false, freeTextSearch: false, orderAndRange: false })`.
 * Mirrors the PSL constructors' `true` defaults declared via
 * `AuthoringArgRef.default`.
 */

import {
  CIPHERSTASH_BIGINT_CODEC_ID,
  CIPHERSTASH_BOOLEAN_CODEC_ID,
  CIPHERSTASH_DATE_CODEC_ID,
  CIPHERSTASH_DOUBLE_CODEC_ID,
  CIPHERSTASH_JSON_CODEC_ID,
  CIPHERSTASH_STRING_CODEC_ID,
  EQL_V2_ENCRYPTED_TYPE,
} from '../extension-metadata/constants';

/**
 * Search-mode parameters for `encryptedString({...})`. Every flag is
 * optional and defaults to `true` when omitted (per spec FR6 +
 * D6 — `orderAndRange` joined the set in Project 2 to give string
 * columns the same sortable / range-queryable surface the numeric +
 * date codecs already had).
 */
export interface EncryptedStringOptions {
  readonly equality?: boolean;
  readonly freeTextSearch?: boolean;
  readonly orderAndRange?: boolean;
}

export interface EncryptedStringColumnDescriptor {
  readonly codecId: typeof CIPHERSTASH_STRING_CODEC_ID;
  readonly nativeType: typeof EQL_V2_ENCRYPTED_TYPE;
  readonly typeParams: {
    readonly equality: boolean;
    readonly freeTextSearch: boolean;
    readonly orderAndRange: boolean;
  };
}

/**
 * `encryptedString({ equality?, freeTextSearch?, orderAndRange? })` —
 * TS contract factory that lowers to a `ColumnTypeDescriptor` with
 * the `cipherstash/string@1` codec and the `eql_v2_encrypted`
 * Postgres native type. Each boolean flag becomes a `typeParams.*`
 * slot; all default to `true`.
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
      orderAndRange: options.orderAndRange ?? true,
    },
  };
}

/**
 * Search-mode parameters for `encryptedDouble({...})` and
 * `encryptedBigInt({...})`. Both flags are optional and default to
 * `true` when omitted (per spec FR6 — searchable encryption is the
 * legitimate default).
 */
export interface EncryptedNumericOptions {
  readonly equality?: boolean;
  readonly orderAndRange?: boolean;
}

export interface EncryptedDoubleColumnDescriptor {
  readonly codecId: typeof CIPHERSTASH_DOUBLE_CODEC_ID;
  readonly nativeType: typeof EQL_V2_ENCRYPTED_TYPE;
  readonly typeParams: {
    readonly equality: boolean;
    readonly orderAndRange: boolean;
  };
}

export interface EncryptedBigIntColumnDescriptor {
  readonly codecId: typeof CIPHERSTASH_BIGINT_CODEC_ID;
  readonly nativeType: typeof EQL_V2_ENCRYPTED_TYPE;
  readonly typeParams: {
    readonly equality: boolean;
    readonly orderAndRange: boolean;
  };
}

/**
 * `encryptedDouble({ equality?, orderAndRange? })` — TS contract
 * factory that lowers to a `ColumnTypeDescriptor` with the
 * `cipherstash/double@1` codec and the `eql_v2_encrypted` Postgres
 * native type. Mirrors what
 * `cipherstash.EncryptedDouble({...})` lowers to byte-for-byte.
 */
export function encryptedDouble(
  options: EncryptedNumericOptions = {},
): EncryptedDoubleColumnDescriptor {
  return {
    codecId: CIPHERSTASH_DOUBLE_CODEC_ID,
    nativeType: EQL_V2_ENCRYPTED_TYPE,
    typeParams: {
      equality: options.equality ?? true,
      orderAndRange: options.orderAndRange ?? true,
    },
  };
}

/**
 * `encryptedBigInt({ equality?, orderAndRange? })` — TS contract
 * factory matching `cipherstash.EncryptedBigInt({...})`.
 */
export function encryptedBigInt(
  options: EncryptedNumericOptions = {},
): EncryptedBigIntColumnDescriptor {
  return {
    codecId: CIPHERSTASH_BIGINT_CODEC_ID,
    nativeType: EQL_V2_ENCRYPTED_TYPE,
    typeParams: {
      equality: options.equality ?? true,
      orderAndRange: options.orderAndRange ?? true,
    },
  };
}

/**
 * Search-mode parameters for `encryptedDate({...})`. Both flags are
 * optional and default to `true` per spec FR6.
 */
export interface EncryptedDateOptions {
  readonly equality?: boolean;
  readonly orderAndRange?: boolean;
}

export interface EncryptedDateColumnDescriptor {
  readonly codecId: typeof CIPHERSTASH_DATE_CODEC_ID;
  readonly nativeType: typeof EQL_V2_ENCRYPTED_TYPE;
  readonly typeParams: {
    readonly equality: boolean;
    readonly orderAndRange: boolean;
  };
}

/**
 * `encryptedDate({ equality?, orderAndRange? })` — TS contract factory
 * matching `cipherstash.EncryptedDate({...})`.
 */
export function encryptedDate(options: EncryptedDateOptions = {}): EncryptedDateColumnDescriptor {
  return {
    codecId: CIPHERSTASH_DATE_CODEC_ID,
    nativeType: EQL_V2_ENCRYPTED_TYPE,
    typeParams: {
      equality: options.equality ?? true,
      orderAndRange: options.orderAndRange ?? true,
    },
  };
}

/**
 * Search-mode parameters for `encryptedBoolean({...})`. The flag is
 * optional and defaults to `true`. Booleans only support equality
 * search (no meaningful range predicate over a 2-value domain).
 */
export interface EncryptedBooleanOptions {
  readonly equality?: boolean;
}

export interface EncryptedBooleanColumnDescriptor {
  readonly codecId: typeof CIPHERSTASH_BOOLEAN_CODEC_ID;
  readonly nativeType: typeof EQL_V2_ENCRYPTED_TYPE;
  readonly typeParams: {
    readonly equality: boolean;
  };
}

/**
 * `encryptedBoolean({ equality? })` — TS contract factory matching
 * `cipherstash.EncryptedBoolean({...})`.
 */
export function encryptedBoolean(
  options: EncryptedBooleanOptions = {},
): EncryptedBooleanColumnDescriptor {
  return {
    codecId: CIPHERSTASH_BOOLEAN_CODEC_ID,
    nativeType: EQL_V2_ENCRYPTED_TYPE,
    typeParams: {
      equality: options.equality ?? true,
    },
  };
}

/**
 * Search-mode parameters for `encryptedJson({...})`. Single flag —
 * `searchableJson` gates the entire `ste_vec` index family (containment
 * + path-extraction predicates). Defaults to `true`.
 */
export interface EncryptedJsonOptions {
  readonly searchableJson?: boolean;
}

export interface EncryptedJsonColumnDescriptor {
  readonly codecId: typeof CIPHERSTASH_JSON_CODEC_ID;
  readonly nativeType: typeof EQL_V2_ENCRYPTED_TYPE;
  readonly typeParams: {
    readonly searchableJson: boolean;
  };
}

/**
 * `encryptedJson({ searchableJson? })` — TS contract factory matching
 * `cipherstash.EncryptedJson({...})`.
 */
export function encryptedJson(options: EncryptedJsonOptions = {}): EncryptedJsonColumnDescriptor {
  return {
    codecId: CIPHERSTASH_JSON_CODEC_ID,
    nativeType: EQL_V2_ENCRYPTED_TYPE,
    typeParams: {
      searchableJson: options.searchableJson ?? true,
    },
  };
}
