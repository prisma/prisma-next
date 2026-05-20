import type {
  ControlFamilyDescriptor,
  ControlStack,
} from '@prisma-next/framework-components/control';
import type { EmissionSpi } from '@prisma-next/framework-components/emission';
import { sqlEmission } from '@prisma-next/sql-contract-emitter';
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
  } as const;
  // Family-reserved per-namespace storage slot. Pack contributions
  // whose `AuthoringEntityTypeDescriptor.storageSlotKey` matches one
  // of these are rejected at descriptor-collection time so a pack
  // cannot accidentally claim the family's built-in slot.
  readonly reservedStorageSlotKeys: ReadonlyArray<string> = ['tables'];

  create<TTargetId extends string>(
    stack: ControlStack<'sql', TTargetId>,
  ): SqlControlFamilyInstance {
    return createSqlFamilyInstance(stack);
  }
}
