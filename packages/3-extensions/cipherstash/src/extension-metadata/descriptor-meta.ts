/**
 * Pack metadata for the cipherstash extension.
 *
 * Mirrors `packages/3-extensions/pgvector/src/extension-metadata/descriptor-meta.ts` —
 * the metadata block that gets serialized into `contract.json`'s
 * `extensionPacks.cipherstash` slot at emit time.
 *
 * SDK-free: the runtime descriptor (forthcoming in M2 R3 alongside the
 * bulk-encrypt middleware) layers SDK-bound codec instances on top at
 * execution time. The `codecInstances` slot here uses the metadata-only
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
 * by TML-2397.
 */

import { cipherstashAuthoringTypes } from '../contract/authoring';
import { cipherstashStringCodecMetadata } from './codec-metadata';
import {
  CIPHERSTASH_SPACE_ID,
  CIPHERSTASH_STRING_CODEC_ID,
  EQL_V2_ENCRYPTED_TYPE,
} from './constants';

export const CIPHERSTASH_EXTENSION_VERSION = '0.0.1' as const;

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
      codecInstances: [cipherstashStringCodecMetadata],
    },
    operationTypes: {
      import: {
        package: '@prisma-next/extension-cipherstash/operation-types',
        named: 'OperationTypes',
        alias: 'CipherstashOperationTypes',
      },
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
    ],
  },
} as const;
