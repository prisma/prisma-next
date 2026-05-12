/**
 * Authoring contributions for the cipherstash extension.
 *
 * Registers `cipherstash.EncryptedString({ equality?, freeTextSearch? })`
 * as a namespaced PSL type constructor. The same descriptor lowers a
 * PSL field-type expression like `cipherstash.EncryptedString({ equality:
 * true })` and a TS factory call like `encryptedString({ equality: true })`
 * (see `../exports/column-types`) to an identical `ColumnTypeDescriptor`
 * so PSL- and TS-authored contracts emit byte-identical `contract.json`.
 *
 * Mirrors `packages/3-extensions/pgvector/src/core/authoring.ts`. The
 * cipherstash variant differs in three respects:
 *   (a) `cipherstash` is the namespace,
 *   (b) the constructor takes a single OPTIONAL object argument with two
 *       optional booleans (so `cipherstash.EncryptedString()`,
 *       `cipherstash.EncryptedString({})`, and the fully-spelled
 *       `cipherstash.EncryptedString({ equality: true, freeTextSearch: true })`
 *       all parse), and
 *   (c) both flags default to `true` — searchable encryption is the
 *       legitimate default for an extension whose entire reason for
 *       existing is to make encrypted columns queryable. Users who want
 *       storage-only encryption opt out explicitly:
 *       `cipherstash.EncryptedString({ equality: false, freeTextSearch: false })`.
 */

import type { AuthoringTypeNamespace } from '@prisma-next/framework-components/authoring';
import {
  CIPHERSTASH_BIGINT_CODEC_ID,
  CIPHERSTASH_BOOLEAN_CODEC_ID,
  CIPHERSTASH_DATE_CODEC_ID,
  CIPHERSTASH_DOUBLE_CODEC_ID,
  CIPHERSTASH_JSON_CODEC_ID,
  CIPHERSTASH_STRING_CODEC_ID,
  EQL_V2_ENCRYPTED_TYPE,
} from './extension-metadata/constants';

export const cipherstashAuthoringTypes = {
  cipherstash: {
    EncryptedString: {
      kind: 'typeConstructor',
      args: [
        {
          kind: 'object',
          name: 'options',
          optional: true,
          properties: {
            equality: { kind: 'boolean', optional: true },
            freeTextSearch: { kind: 'boolean', optional: true },
          },
        },
      ],
      output: {
        codecId: CIPHERSTASH_STRING_CODEC_ID,
        nativeType: EQL_V2_ENCRYPTED_TYPE,
        typeParams: {
          equality: { kind: 'arg', index: 0, path: ['equality'], default: true },
          freeTextSearch: {
            kind: 'arg',
            index: 0,
            path: ['freeTextSearch'],
            default: true,
          },
        },
      },
    },
    EncryptedDouble: {
      kind: 'typeConstructor',
      args: [
        {
          kind: 'object',
          name: 'options',
          optional: true,
          properties: {
            equality: { kind: 'boolean', optional: true },
            orderAndRange: { kind: 'boolean', optional: true },
          },
        },
      ],
      output: {
        codecId: CIPHERSTASH_DOUBLE_CODEC_ID,
        nativeType: EQL_V2_ENCRYPTED_TYPE,
        typeParams: {
          equality: { kind: 'arg', index: 0, path: ['equality'], default: true },
          orderAndRange: {
            kind: 'arg',
            index: 0,
            path: ['orderAndRange'],
            default: true,
          },
        },
      },
    },
    EncryptedBigInt: {
      kind: 'typeConstructor',
      args: [
        {
          kind: 'object',
          name: 'options',
          optional: true,
          properties: {
            equality: { kind: 'boolean', optional: true },
            orderAndRange: { kind: 'boolean', optional: true },
          },
        },
      ],
      output: {
        codecId: CIPHERSTASH_BIGINT_CODEC_ID,
        nativeType: EQL_V2_ENCRYPTED_TYPE,
        typeParams: {
          equality: { kind: 'arg', index: 0, path: ['equality'], default: true },
          orderAndRange: {
            kind: 'arg',
            index: 0,
            path: ['orderAndRange'],
            default: true,
          },
        },
      },
    },
    EncryptedDate: {
      kind: 'typeConstructor',
      args: [
        {
          kind: 'object',
          name: 'options',
          optional: true,
          properties: {
            equality: { kind: 'boolean', optional: true },
            orderAndRange: { kind: 'boolean', optional: true },
          },
        },
      ],
      output: {
        codecId: CIPHERSTASH_DATE_CODEC_ID,
        nativeType: EQL_V2_ENCRYPTED_TYPE,
        typeParams: {
          equality: { kind: 'arg', index: 0, path: ['equality'], default: true },
          orderAndRange: {
            kind: 'arg',
            index: 0,
            path: ['orderAndRange'],
            default: true,
          },
        },
      },
    },
    EncryptedBoolean: {
      kind: 'typeConstructor',
      args: [
        {
          kind: 'object',
          name: 'options',
          optional: true,
          properties: {
            equality: { kind: 'boolean', optional: true },
          },
        },
      ],
      output: {
        codecId: CIPHERSTASH_BOOLEAN_CODEC_ID,
        nativeType: EQL_V2_ENCRYPTED_TYPE,
        typeParams: {
          equality: { kind: 'arg', index: 0, path: ['equality'], default: true },
        },
      },
    },
    EncryptedJson: {
      kind: 'typeConstructor',
      args: [
        {
          kind: 'object',
          name: 'options',
          optional: true,
          properties: {
            searchableJson: { kind: 'boolean', optional: true },
          },
        },
      ],
      output: {
        codecId: CIPHERSTASH_JSON_CODEC_ID,
        nativeType: EQL_V2_ENCRYPTED_TYPE,
        typeParams: {
          searchableJson: {
            kind: 'arg',
            index: 0,
            path: ['searchableJson'],
            default: true,
          },
        },
      },
    },
  },
} as const satisfies AuthoringTypeNamespace;
