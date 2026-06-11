import type { CodecRegistry } from '@prisma-next/framework-components/codec';
import { extractCodecLookup } from '@prisma-next/framework-components/control';
import { sqliteCodecRegistry } from '@prisma-next/target-sqlite/codecs';

/**
 * Build a {@link CodecRegistry} populated with the SQLite-builtin codec definitions only.
 *
 * Used by `createSqliteAdapter()` and `new SqliteControlAdapter()` when called without a
 * stack-derived registry (e.g. from tests, or one-off scripts that don't compose a full stack).
 *
 * Extension codecs are intentionally NOT included: a bare adapter cannot see extensions.
 * Stack-composed paths supply the broader, extension-inclusive registry at construction time.
 */
export function createSqliteBuiltinCodecLookup(): CodecRegistry {
  return extractCodecLookup([
    {
      id: 'sqlite-builtin-codecs',
      types: { codecTypes: { codecDescriptors: Array.from(sqliteCodecRegistry.values()) } },
    },
  ]);
}
