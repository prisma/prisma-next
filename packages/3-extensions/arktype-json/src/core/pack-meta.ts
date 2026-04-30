/**
 * arktype-json pack metadata.
 *
 * The pack metadata is the framework-composition entry point: control-
 * stack assembly reads `types.codecTypes.import` to thread the type-side
 * imports into emitted `contract.d.ts`, and `types.storage` declares the
 * codec id's storage backing (`jsonb` on Postgres).
 *
 * Per Phase B of codec-registry-unification, `codecInstances` is empty:
 * arktype-json's metadata flows through the unified descriptor map
 * (`arktypeJsonCodec` parameterized descriptor), not through the legacy
 * codec lookup. Control-stack consumers read codec metadata from
 * `descriptorFor('arktype/json@1')`.
 */

import type { CodecTypes } from '../types/codec-types';
import { ARKTYPE_JSON_CODEC_ID } from './arktype-json-codec';

const arktypeJsonPackMetaBase = {
  kind: 'extension',
  id: 'arktype-json',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
  capabilities: {},
  types: {
    codecTypes: {
      // Phase B: parameterized descriptor is the single source of truth
      // for codec-id-keyed metadata; the legacy `codecInstances` array
      // stays empty.
      codecInstances: [] as const,
      import: {
        package: '@prisma-next/extension-arktype-json/codec-types',
        named: 'CodecTypes',
        alias: 'ArktypeJsonTypes',
      },
    },
    storage: [
      {
        typeId: ARKTYPE_JSON_CODEC_ID,
        familyId: 'sql' as const,
        targetId: 'postgres' as const,
        nativeType: 'jsonb',
      },
    ],
  },
} as const;

/**
 * Public pack metadata. The phantom `__codecTypes` field threads the
 * codec-types map's literal type into the pack ref so contract-builder
 * generics can pick it up; it is never accessed at runtime.
 */
export const arktypeJsonPackMeta: typeof arktypeJsonPackMetaBase & {
  readonly __codecTypes?: CodecTypes;
} = arktypeJsonPackMetaBase;
