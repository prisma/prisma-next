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
 *   (b) the constructor takes a single object argument with two
 *       optional booleans, and
 *   (c) both flags default to `false` — storage-only encryption is the
 *       legitimate default per the project's M2 standing decision
 *       ("Plaintext-zeroing decision (Open Item 6, resolved 2026-05-06)").
 */

import type { AuthoringTypeNamespace } from '@prisma-next/framework-components/authoring';
import { CIPHERSTASH_STRING_CODEC_ID, EQL_V2_ENCRYPTED_TYPE } from './constants';

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
        nativeType: EQL_V2_ENCRYPTED_TYPE,
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
