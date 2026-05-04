/**
 * Runtime-plane extension descriptor for arktype-json.
 *
 * Registers `arktypeJsonCodec` (the parameterized codec descriptor)
 * through the SQL runtime's `parameterizedCodecs:` slot. Per Phase B of
 * codec-registry-unification, the legacy `codecs:` slot returns an empty
 * registry — the unified descriptor map subsumes the codec-id-keyed
 * metadata reads that the legacy slot used to back, and the runtime
 * dispatch (`forColumn`) materializes the per-instance codec from the
 * descriptor's factory.
 *
 * Lives at the runtime-plane entrypoint so `src/core/**` stays free of
 * runtime-plane imports (per `.cursor/rules/multi-plane-entrypoints.mdc`).
 */

import { createCodecRegistry } from '@prisma-next/sql-relational-core/ast';
import type { SqlRuntimeExtensionDescriptor } from '@prisma-next/sql-runtime';
import { arktypeJsonCodec, arktypeJsonEmitCodec } from '../core/arktype-json-codec';
import { arktypeJsonPackMeta } from '../core/pack-meta';

function createArktypeJsonCodecRegistry() {
  // arktype-json ships only the parameterized descriptor; the legacy
  // `codecs:` slot has nothing to register.
  return createCodecRegistry();
}

export const arktypeJsonRuntimeDescriptor: SqlRuntimeExtensionDescriptor<'postgres'> = {
  kind: 'extension' as const,
  id: arktypeJsonPackMeta.id,
  version: arktypeJsonPackMeta.version,
  familyId: 'sql' as const,
  targetId: 'postgres' as const,
  // Mirror `arktypeJsonPackMeta.types.codecTypes.codecInstances` here so
  // that the runtime-plane `extractCodecLookup` (called by the postgres
  // adapter at `create()` time, see
  // `packages/3-targets/6-adapters/postgres/src/exports/runtime.ts`)
  // discovers `arktype/json@1`. Without this, `renderTypedParam` throws
  // "assembled codec lookup has no entry" the first time a query touches
  // an arktypeJson column. The codec carries `meta.db.sql.postgres.nativeType`
  // = `'jsonb'` so the renderer emits `$N::jsonb` (jsonb is excluded from
  // `POSTGRES_INFERRABLE_NATIVE_TYPES`, so the cast is required).
  // Encode/decode dispatch goes through the unified descriptor map's
  // `factory(params)(ctx)`, never through this metadata stub.
  types: {
    codecTypes: {
      codecInstances: [arktypeJsonEmitCodec],
    },
  },
  codecs: createArktypeJsonCodecRegistry,
  parameterizedCodecs: () => [arktypeJsonCodec],
  create() {
    return {
      familyId: 'sql' as const,
      targetId: 'postgres' as const,
    };
  },
};

export default arktypeJsonRuntimeDescriptor;
