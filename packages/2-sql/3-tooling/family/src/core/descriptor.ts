import type {
  ControlFamilyDescriptor,
  ControlPlaneStack,
} from '@prisma-next/core-control-plane/types';
import { sqlTargetFamilyHook } from '@prisma-next/sql-contract-emitter';
import { createSqlFamilyInstance, type SqlControlFamilyInstance } from './instance';

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

  create<TTargetId extends string>(
    stack: ControlPlaneStack<'sql', TTargetId>,
  ): SqlControlFamilyInstance {
    return createSqlFamilyInstance({
      target: stack.target,
      adapter: stack.adapter,
      extensionPacks: stack.extensionPacks,
    });
  }
}
