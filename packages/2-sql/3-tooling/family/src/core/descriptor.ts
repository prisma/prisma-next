import type {
  ControlAdapterDescriptor,
  ControlDriverDescriptor,
  ControlExtensionDescriptor,
  ControlFamilyDescriptor,
} from '@prisma-next/core-control-plane/types';
import { sqlTargetFamilyHook } from '@prisma-next/sql-contract-emitter';
import type { SqlControlAdapter } from './control-adapter';
import { createSqlFamilyInstance, type SqlControlFamilyInstance } from './instance';
import type { SqlControlTargetDescriptor } from './migrations/types';

/**
 * SQL family descriptor implementation.
 * Provides the SQL family hook and factory method.
 */
export class SqlFamilyDescriptor
  implements ControlFamilyDescriptor<'sql', SqlControlFamilyInstance>
{
  readonly kind = 'family' as const;
  readonly id = 'sql';
  readonly familyId = 'sql' as const;
  readonly version = '0.0.1';
  readonly hook = sqlTargetFamilyHook;

  create<TTargetId extends string, TTargetDetails>(options: {
    readonly target: SqlControlTargetDescriptor<TTargetId, TTargetDetails>;
    readonly adapter: ControlAdapterDescriptor<'sql', TTargetId, SqlControlAdapter<TTargetId>>;
    readonly driver: ControlDriverDescriptor<'sql', TTargetId>;
    readonly extensionPacks: readonly ControlExtensionDescriptor<'sql', TTargetId>[];
  }): SqlControlFamilyInstance {
    return createSqlFamilyInstance({
      target: options.target,
      adapter: options.adapter,
      extensionPacks: options.extensionPacks,
    });
  }
}
