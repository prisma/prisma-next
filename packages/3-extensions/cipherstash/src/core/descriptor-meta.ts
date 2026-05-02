/**
 * Pack metadata for the cipherstash extension.
 *
 * Mirrors `packages/3-extensions/pgvector/src/core/descriptor-meta.ts` —
 * the metadata block that gets serialized into `contract.json`'s
 * `extensionPacks.cipherstash` slot at emit time. SDK-free; the runtime
 * descriptor (`exports/runtime.ts`) layers SDK-bound codec instances on
 * top at execution time.
 *
 * The `codecInstances` entry uses the metadata-only codec from
 * `core/codecs.ts` because pack-meta consumers only read codec metadata
 * (typeId, targetTypes, traits, renderOutputType); execution-time
 * encode/decode always go through the runtime descriptor's SDK-bound
 * codec.
 */

import { cipherstashAuthoringTypes } from './authoring';
import {
  CIPHERSTASH_STRING_CODEC_ID,
  CIPHERSTASH_STRING_TARGET_TYPE,
  cipherstashStringCodecMetadata,
} from './codecs';

export const CIPHERSTASH_EXTENSION_ID = 'cipherstash' as const;
export const CIPHERSTASH_EXTENSION_VERSION = '0.0.1' as const;

export const cipherstashPackMeta = {
  kind: 'extension',
  id: CIPHERSTASH_EXTENSION_ID,
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
    storage: [
      {
        typeId: CIPHERSTASH_STRING_CODEC_ID,
        familyId: 'sql',
        targetId: 'postgres',
        nativeType: CIPHERSTASH_STRING_TARGET_TYPE,
      },
    ],
  },
} as const;
