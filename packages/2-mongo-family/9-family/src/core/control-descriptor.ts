import type {
  ControlFamilyDescriptor,
  ControlStack,
} from '@prisma-next/framework-components/control';
import { mongoEmission } from '@prisma-next/mongo-emitter';
import { createMongoFamilyInstance, type MongoControlFamilyInstance } from './control-instance';

class MongoFamilyDescriptor
  implements ControlFamilyDescriptor<'mongo', MongoControlFamilyInstance>
{
  readonly kind = 'family' as const;
  readonly id = 'mongo';
  readonly familyId = 'mongo' as const;
  readonly version = '0.0.1';
  readonly emission = mongoEmission;
  // Family-reserved per-namespace storage slot. See SqlFamilyDescriptor
  // for the rationale; Mongo's built-in slot is `collections`.
  readonly reservedStorageSlotKeys: ReadonlyArray<string> = ['collections'];

  create<TTargetId extends string>(
    stack: ControlStack<'mongo', TTargetId>,
  ): MongoControlFamilyInstance {
    return createMongoFamilyInstance(stack);
  }
}

export const mongoFamilyDescriptor: ControlFamilyDescriptor<'mongo', MongoControlFamilyInstance> =
  new MongoFamilyDescriptor();
