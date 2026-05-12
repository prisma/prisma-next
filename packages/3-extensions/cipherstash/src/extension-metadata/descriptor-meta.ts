/**
 * Pack metadata for the cipherstash extension.
 *
 * Mirrors `packages/3-extensions/pgvector/src/extension-metadata/descriptor-meta.ts` —
 * the metadata block that gets serialized into `contract.json`'s
 * `extensionPacks.cipherstash` slot at emit time.
 *
 * SDK-free: the runtime descriptor layers SDK-bound codec instances on
 * top at execution time. The `codecInstances` slot here uses the
 * metadata-only
 * codec from `./codec-metadata` because pack-meta consumers only read
 * codec metadata (typeId, targetTypes, traits, renderOutputType);
 * runtime encode/decode always go through the SDK-bound codec produced
 * by `RuntimeParameterizedCodecDescriptor.factory` (see
 * `./parameterized`).
 *
 * The control descriptor in `../exports/control.ts` spreads this pack
 * meta so the framework's contract emitter sees `authoring`,
 * `types.codecTypes.codecInstances`, and `types.storage` alongside
 * the contract-space and codec-lifecycle-hooks blocks already wired
 * by the codec lifecycle hook block.
 */

import { cipherstashAuthoringTypes } from '../contract-authoring';
import {
  cipherstashBigIntCodecMetadata,
  cipherstashBooleanCodecMetadata,
  cipherstashDateCodecMetadata,
  cipherstashDoubleCodecMetadata,
  cipherstashJsonCodecMetadata,
  cipherstashStringCodecMetadata,
} from './codec-metadata';
import {
  CIPHERSTASH_BIGINT_CODEC_ID,
  CIPHERSTASH_BOOLEAN_CODEC_ID,
  CIPHERSTASH_DATE_CODEC_ID,
  CIPHERSTASH_DOUBLE_CODEC_ID,
  CIPHERSTASH_EXTENSION_VERSION,
  CIPHERSTASH_JSON_CODEC_ID,
  CIPHERSTASH_SPACE_ID,
  CIPHERSTASH_STRING_CODEC_ID,
  EQL_V2_ENCRYPTED_TYPE,
} from './constants';

export { CIPHERSTASH_EXTENSION_VERSION };

export const cipherstashPackMeta = {
  kind: 'extension',
  id: CIPHERSTASH_SPACE_ID,
  familyId: 'sql',
  targetId: 'postgres',
  version: CIPHERSTASH_EXTENSION_VERSION,
  authoring: {
    type: cipherstashAuthoringTypes,
  },
  types: {
    codecTypes: {
      codecInstances: [
        cipherstashStringCodecMetadata,
        cipherstashDoubleCodecMetadata,
        cipherstashBigIntCodecMetadata,
        cipherstashDateCodecMetadata,
        cipherstashBooleanCodecMetadata,
        cipherstashJsonCodecMetadata,
      ],
      // `renderOutputType` returns the bare envelope type name (e.g.
      // `EncryptedString`, `EncryptedDouble`) for parameterized
      // cipherstash columns; the contract emitter needs to import each
      // type alongside its occurrence so the generated `.d.ts`
      // typechecks cleanly. Mirrors pgvector's `Vector` typeImports
      // declaration.
      typeImports: [
        {
          package: '@prisma-next/extension-cipherstash/runtime',
          named: 'EncryptedString',
          alias: 'EncryptedString',
        },
        {
          package: '@prisma-next/extension-cipherstash/runtime',
          named: 'EncryptedDouble',
          alias: 'EncryptedDouble',
        },
        {
          package: '@prisma-next/extension-cipherstash/runtime',
          named: 'EncryptedBigInt',
          alias: 'EncryptedBigInt',
        },
        {
          package: '@prisma-next/extension-cipherstash/runtime',
          named: 'EncryptedDate',
          alias: 'EncryptedDate',
        },
        {
          package: '@prisma-next/extension-cipherstash/runtime',
          named: 'EncryptedBoolean',
          alias: 'EncryptedBoolean',
        },
        {
          package: '@prisma-next/extension-cipherstash/runtime',
          named: 'EncryptedJson',
          alias: 'EncryptedJson',
        },
      ],
    },
    queryOperationTypes: {
      import: {
        package: '@prisma-next/extension-cipherstash/operation-types',
        named: 'QueryOperationTypes',
        alias: 'CipherstashQueryOperationTypes',
      },
    },
    storage: [
      {
        typeId: CIPHERSTASH_STRING_CODEC_ID,
        familyId: 'sql',
        targetId: 'postgres',
        nativeType: EQL_V2_ENCRYPTED_TYPE,
      },
      {
        typeId: CIPHERSTASH_DOUBLE_CODEC_ID,
        familyId: 'sql',
        targetId: 'postgres',
        nativeType: EQL_V2_ENCRYPTED_TYPE,
      },
      {
        typeId: CIPHERSTASH_BIGINT_CODEC_ID,
        familyId: 'sql',
        targetId: 'postgres',
        nativeType: EQL_V2_ENCRYPTED_TYPE,
      },
      {
        typeId: CIPHERSTASH_DATE_CODEC_ID,
        familyId: 'sql',
        targetId: 'postgres',
        nativeType: EQL_V2_ENCRYPTED_TYPE,
      },
      {
        typeId: CIPHERSTASH_BOOLEAN_CODEC_ID,
        familyId: 'sql',
        targetId: 'postgres',
        nativeType: EQL_V2_ENCRYPTED_TYPE,
      },
      {
        typeId: CIPHERSTASH_JSON_CODEC_ID,
        familyId: 'sql',
        targetId: 'postgres',
        nativeType: EQL_V2_ENCRYPTED_TYPE,
      },
    ],
  },
} as const;
