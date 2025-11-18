import type { ExtensionPackManifest } from '@prisma-next/core-control-plane/pack-manifest-types';
import type {
  RuntimeAdapterDescriptor,
  RuntimeDriverDescriptor,
  RuntimeExtensionDescriptor,
  RuntimeFamilyDescriptor,
  RuntimeTargetDescriptor,
} from '@prisma-next/core-execution-plane/types';
import { createSqlRuntimeFamilyInstance, type SqlRuntimeFamilyInstance } from './runtime-instance';

/**
 * SQL family manifest for runtime plane.
 */
const sqlFamilyManifest: ExtensionPackManifest = {
  id: 'sql',
  version: '0.0.1',
};

/**
 * SQL runtime family descriptor implementation.
 * Provides factory method to create SQL runtime family instance.
 */
export class SqlRuntimeFamilyDescriptor
  implements RuntimeFamilyDescriptor<'sql', SqlRuntimeFamilyInstance>
{
  readonly kind = 'family' as const;
  readonly id = 'sql';
  readonly familyId = 'sql' as const;
  readonly manifest = sqlFamilyManifest;

  create<TTargetId extends string>(options: {
    readonly target: RuntimeTargetDescriptor<'sql', TTargetId>;
    readonly adapter: RuntimeAdapterDescriptor<'sql', TTargetId>;
    readonly driver: RuntimeDriverDescriptor<'sql', TTargetId>;
    readonly extensions: readonly RuntimeExtensionDescriptor<'sql', TTargetId>[];
  }): SqlRuntimeFamilyInstance {
    return createSqlRuntimeFamilyInstance({
      target: options.target,
      adapter: options.adapter,
      driver: options.driver,
      extensions: options.extensions,
    });
  }
}
