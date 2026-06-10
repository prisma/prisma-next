import type {
  ControlFamilyDescriptor,
  ControlStack,
} from '@prisma-next/framework-components/control';
import type { EmissionSpi } from '@prisma-next/framework-components/emission';
import { sqlEmission } from '@prisma-next/sql-contract-emitter';
import { sqlFamilyPslBlockDescriptors } from './authoring-entity-types';
import { sqlFamilyAuthoringFieldPresets } from './authoring-field-presets';
import { sqlFamilyAuthoringTypes } from './authoring-type-constructors';
import { createSqlFamilyInstance, type SqlControlFamilyInstance } from './control-instance';

export class SqlFamilyDescriptor
  implements ControlFamilyDescriptor<'sql', SqlControlFamilyInstance>
{
  readonly kind = 'family' as const;
  readonly id = 'sql';
  readonly familyId = 'sql' as const;
  readonly version = '0.0.1';
  readonly emission: EmissionSpi = sqlEmission;
  readonly authoring = {
    field: sqlFamilyAuthoringFieldPresets,
    type: sqlFamilyAuthoringTypes,
    pslBlockDescriptors: sqlFamilyPslBlockDescriptors,
  } as const;

  create<TTargetId extends string>(
    stack: ControlStack<'sql', TTargetId>,
  ): SqlControlFamilyInstance {
    return createSqlFamilyInstance(stack);
  }
}
