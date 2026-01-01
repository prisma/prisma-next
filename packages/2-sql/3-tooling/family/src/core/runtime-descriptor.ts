import type {
  RuntimeAdapterDescriptor,
  RuntimeDriverDescriptor,
  RuntimeExtensionDescriptor,
  RuntimeFamilyDescriptor,
  RuntimeTargetDescriptor,
} from '@prisma-next/core-execution-plane/types';
import {
  createSqlRuntimeFamilyInstance,
  type SqlRuntimeAdapterInstance,
  type SqlRuntimeDriverInstance,
  type SqlRuntimeFamilyInstance,
} from './runtime-instance';

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
  readonly version = '0.0.1';

  create<TTargetId extends string>(options: {
    readonly target: RuntimeTargetDescriptor<'sql', TTargetId>;
    readonly adapter: RuntimeAdapterDescriptor<
      'sql',
      TTargetId,
      SqlRuntimeAdapterInstance<TTargetId>
    >;
    readonly driver: RuntimeDriverDescriptor<'sql', TTargetId, SqlRuntimeDriverInstance<TTargetId>>;
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
