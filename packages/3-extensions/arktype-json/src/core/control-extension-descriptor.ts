/**
 * Control-plane extension descriptor for arktype-json.
 *
 * Composes pack metadata and the parameterized codec descriptor into the
 * migration-plane shape the framework's control stack consumes.
 *
 * Unlike pgvector, arktype-json has no database extension to install
 * (`jsonb` is a built-in Postgres type), no `controlPlaneHooks` (the
 * codec doesn't expand its native type with params at DDL time — `jsonb`
 * is dimension-free), and no query operations. The descriptor's only
 * job is to register `arktypeJsonCodec` with the emit-path so
 * `renderOutputType` flows into `contract.d.ts`.
 */

import type { SqlControlExtensionDescriptor } from '@prisma-next/family-sql/control';
import { ARKTYPE_JSON_CODEC_ID, arktypeJsonCodec } from './arktype-json-codec';
import { arktypeJsonControlPlaneHooks } from './control-hooks';
import { arktypeJsonPackMeta } from './pack-meta';

export const arktypeJsonExtensionDescriptor: SqlControlExtensionDescriptor<'postgres'> = {
  ...arktypeJsonPackMeta,
  types: {
    ...arktypeJsonPackMeta.types,
    codecTypes: {
      ...arktypeJsonPackMeta.types.codecTypes,
      // Register the parameterized codec descriptor with the control stack so
      // the emitter can read `renderOutputType` off the descriptor. The
      // identity-only `controlPlaneHooks.expandNativeType` keeps the migration
      // planner happy when a column carries typeParams (`jsonb` doesn't
      // accept dimension-style params, so the native type renders as bare
      // `jsonb`).
      controlPlaneHooks: {
        [ARKTYPE_JSON_CODEC_ID]: arktypeJsonControlPlaneHooks,
      },
      parameterizedCodecs: [arktypeJsonCodec],
    },
  },
  create: () => ({
    familyId: 'sql' as const,
    targetId: 'postgres' as const,
  }),
};
