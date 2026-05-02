/**
 * Authoring contributions for the cipherstash extension.
 *
 * Registers `cipherstash.EncryptedString({ equality?, freeTextSearch? })` as
 * a namespaced PSL type constructor and its TS-side equivalent. The same
 * constructor descriptor lowers a PSL field-type expression like
 * `cipherstash.EncryptedString({ equality: true })` and a TS factory call
 * like `type.cipherstash.EncryptedString({ equality: true })` to an
 * identical `ColumnTypeDescriptor` so authoring sources stay byte-equal at
 * the contract IR.
 *
 * Mirrors `packages/3-extensions/pgvector/src/core/authoring.ts` — the
 * differences are (a) `cipherstash` is the namespace, (b) the constructor
 * takes a single object argument with two optional booleans, and (c) the
 * default value for both flags is `false` (storage-only encryption is the
 * legitimate default per the project's M2 standing decision).
 */

import type { AuthoringTypeNamespace } from '@prisma-next/framework-components/authoring';
import { CIPHERSTASH_STRING_CODEC_ID, CIPHERSTASH_STRING_TARGET_TYPE } from './codecs';

export const cipherstashAuthoringTypes = {
  cipherstash: {
    EncryptedString: {
      kind: 'typeConstructor',
      args: [
        {
          kind: 'object',
          name: 'options',
          properties: {
            equality: { kind: 'boolean', optional: true },
            freeTextSearch: { kind: 'boolean', optional: true },
          },
        },
      ],
      output: {
        codecId: CIPHERSTASH_STRING_CODEC_ID,
        nativeType: CIPHERSTASH_STRING_TARGET_TYPE,
        typeParams: {
          equality: { kind: 'arg', index: 0, path: ['equality'], default: false },
          freeTextSearch: {
            kind: 'arg',
            index: 0,
            path: ['freeTextSearch'],
            default: false,
          },
        },
      },
    },
  },
} as const satisfies AuthoringTypeNamespace;
