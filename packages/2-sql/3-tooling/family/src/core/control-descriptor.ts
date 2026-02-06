import type { TargetDescriptor } from '@prisma-next/contract/framework-components';
import type {
  ControlFamilyDescriptor,
  ControlPlaneStack,
} from '@prisma-next/core-control-plane/types';
import { sqlTargetFamilyHook } from '@prisma-next/sql-contract-emitter';
import type { SqlControlDescriptorWithContributions } from './assembly';
import { createSqlFamilyInstance, type SqlControlFamilyInstance } from './control-instance';
import type {
  SqlControlAdapterDescriptor,
  SqlControlExtensionDescriptor,
} from './migrations/types';

export class SqlFamilyDescriptor
  implements ControlFamilyDescriptor<'sql', SqlControlFamilyInstance>
{
  readonly kind = 'family' as const;
  readonly id = 'sql';
  readonly familyId = 'sql' as const;
  readonly version = '0.0.1';
  readonly hook = sqlTargetFamilyHook;

  create<TTargetId extends string>(
    stack: ControlPlaneStack<'sql', TTargetId>,
  ): SqlControlFamilyInstance {
    const target = stack.target as unknown as TargetDescriptor<'sql', TTargetId> &
      SqlControlDescriptorWithContributions;
    const adapter = stack.adapter as unknown as SqlControlAdapterDescriptor<TTargetId>;
    const extensionPacks =
      stack.extensionPacks as unknown as readonly SqlControlExtensionDescriptor<TTargetId>[];
    return createSqlFamilyInstance({
      target,
      adapter,
      extensionPacks,
    });
  }
}
