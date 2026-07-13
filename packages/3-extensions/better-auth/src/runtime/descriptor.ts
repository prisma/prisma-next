import type { SqlRuntimeExtensionDescriptor } from '@prisma-next/sql-runtime';
import packageJson from '../../package.json' with { type: 'json' };

/**
 * Tells the runtime that the better-auth pack's runtime component is
 * available.
 *
 * An app whose aggregate contract lists the better-auth pack (via
 * `extensionPacks: [betterAuthPack]` in its config) cannot construct a
 * `postgres()` client without a matching runtime descriptor — the
 * requirement check rejects the contract with "Contract requires
 * extension pack 'better-auth'". Pass this descriptor through the
 * client's public `extensions` option:
 *
 * ```ts
 * import betterAuthRuntimeDescriptor from '@prisma-next/extension-better-auth/runtime';
 *
 * const db = postgres<Contract>({
 *   contractJson,
 *   url,
 *   extensions: [betterAuthRuntimeDescriptor],
 * });
 * ```
 *
 * Descriptor only — the pack contributes no codecs, query operations, or
 * runtime behaviour beyond satisfying the requirement check (its four
 * tables use standard postgres codecs). There is no wrapped client
 * facade; apps use plain `postgres()`.
 */
export const betterAuthRuntimeDescriptor: SqlRuntimeExtensionDescriptor<'postgres'> = {
  kind: 'extension' as const,
  id: 'better-auth',
  version: packageJson.version,
  familyId: 'sql' as const,
  targetId: 'postgres' as const,
  codecs: () => [],
  create() {
    return {
      familyId: 'sql' as const,
      targetId: 'postgres' as const,
    };
  },
};
