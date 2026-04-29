/**
 * Runtime-plane extension descriptor for arktype-json.
 *
 * Registers `arktypeJsonCodec` (the parameterized codec descriptor) through
 * the SQL runtime's `parameterizedCodecs:` slot. Per Phase 3.5a of
 * codec-registry-unification, the legacy `codecs:` slot returns an empty
 * registry — the unified descriptor map subsumes the codec-id-keyed
 * metadata reads that the legacy slot used to back, and the runtime
 * dispatch (`forColumn`) materializes the per-instance codec from the
 * descriptor's factory.
 */

import { createCodecRegistry } from '@prisma-next/sql-relational-core/ast';
import type { SqlRuntimeExtensionDescriptor } from '@prisma-next/sql-runtime';
import { arktypeJsonCodec } from './arktype-json-codec';
import { arktypeJsonPackMeta } from './pack-meta';

function createArktypeJsonCodecRegistry() {
  // arktype-json ships only the parameterized descriptor; the legacy
  // `codecs:` slot has nothing to register. See Phase 3.5a T3.5.13.
  return createCodecRegistry();
}

export const arktypeJsonRuntimeDescriptor: SqlRuntimeExtensionDescriptor<'postgres'> = {
  kind: 'extension' as const,
  id: arktypeJsonPackMeta.id,
  version: arktypeJsonPackMeta.version,
  familyId: 'sql' as const,
  targetId: 'postgres' as const,
  codecs: createArktypeJsonCodecRegistry,
  parameterizedCodecs: () => [arktypeJsonCodec],
  create() {
    return {
      familyId: 'sql' as const,
      targetId: 'postgres' as const,
    };
  },
};
