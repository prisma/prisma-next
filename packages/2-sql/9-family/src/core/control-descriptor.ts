import type { ControlFamilyDescriptor } from '@prisma-next/core-control-plane/types';
import type { ControlStack } from '@prisma-next/framework-components/control';
import { sqlTargetFamilyHook } from '@prisma-next/sql-contract-emitter';
import { createSqlFamilyInstance, type SqlControlFamilyInstance } from './control-instance';

export class SqlFamilyDescriptor
  implements ControlFamilyDescriptor<'sql', SqlControlFamilyInstance>
{
  readonly kind = 'family' as const;
  readonly id = 'sql';
  readonly familyId = 'sql' as const;
  readonly version = '0.0.1';
  readonly hook = sqlTargetFamilyHook;

  create<TTargetId extends string>(
    stack: ControlStack<'sql', TTargetId>,
  ): SqlControlFamilyInstance {
    return createSqlFamilyInstance(stack);
  }
}
