/**
 * Control-plane extension descriptor for arktype-json.
 *
 * Composes pack metadata and the control-plane hooks into the migration-
 * plane shape the framework's control stack consumes.
 *
 * Unlike pgvector, arktype-json has no database extension to install
 * (`jsonb` is a built-in Postgres type), no `databaseDependencies`, no
 * query operations, and the only control-plane hook is the identity
 * `expandNativeType` (jsonb is dimension-free; the schema in typeParams
 * affects runtime validation only, never DDL).
 */

import type { SqlControlExtensionDescriptor } from '@prisma-next/family-sql/control';
import { ARKTYPE_JSON_CODEC_ID } from './arktype-json-codec';
import { arktypeJsonControlPlaneHooks } from './control-hooks';
import { arktypeJsonPackMeta } from './pack-meta';

export const arktypeJsonExtensionDescriptor: SqlControlExtensionDescriptor<'postgres'> = {
  ...arktypeJsonPackMeta,
  types: {
    ...arktypeJsonPackMeta.types,
    codecTypes: {
      ...arktypeJsonPackMeta.types.codecTypes,
      controlPlaneHooks: {
        [ARKTYPE_JSON_CODEC_ID]: arktypeJsonControlPlaneHooks,
      },
    },
  },
  create: () => ({
    familyId: 'sql' as const,
    targetId: 'postgres' as const,
  }),
};
