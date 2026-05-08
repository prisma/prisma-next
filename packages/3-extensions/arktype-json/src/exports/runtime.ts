/**
 * Runtime-plane extension descriptor for arktype-json.
 *
 * Registers `arktypeJsonCodec` (the unified `CodecDescriptor`) through
 * the SQL runtime's `codecs:` slot. Per TML-2357 the
 * dedicated parameterized-codec slot retired — the unified descriptor
 * map dispatches every codec id, parameterized or not.
 *
 * Lives at the runtime-plane entrypoint so `src/core/**` stays free of
 * runtime-plane imports (per `.cursor/rules/multi-plane-entrypoints.mdc`).
 */

import type { SqlRuntimeExtensionDescriptor } from '@prisma-next/sql-runtime';
import { codecDescriptorClassList } from '../core/arktype-json-codec-class';
import { arktypeJsonPackMeta } from '../core/pack-meta';

export const arktypeJsonRuntimeDescriptor: SqlRuntimeExtensionDescriptor<'postgres'> = {
  kind: 'extension' as const,
  id: arktypeJsonPackMeta.id,
  version: arktypeJsonPackMeta.version,
  familyId: 'sql' as const,
  targetId: 'postgres' as const,
  codecs: () => codecDescriptorClassList,
  create() {
    return {
      familyId: 'sql' as const,
      targetId: 'postgres' as const,
    };
  },
};

export default arktypeJsonRuntimeDescriptor;
