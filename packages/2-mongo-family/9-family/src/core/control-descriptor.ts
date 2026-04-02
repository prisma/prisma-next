import type { AssembledComponentState } from '@prisma-next/contract/assembly';
import type {
  ControlFamilyDescriptor,
  ControlPlaneStack,
} from '@prisma-next/core-control-plane/types';
import { mongoTargetFamilyHook } from '@prisma-next/mongo-emitter';
import { createMongoFamilyInstance, type MongoControlFamilyInstance } from './control-instance';

export class MongoFamilyDescriptor
  implements ControlFamilyDescriptor<'mongo', MongoControlFamilyInstance>
{
  readonly kind = 'family' as const;
  readonly id = 'mongo';
  readonly familyId = 'mongo' as const;
  readonly version = '0.0.1';
  readonly hook = mongoTargetFamilyHook;

  create<TTargetId extends string>(
    _stack: ControlPlaneStack<'mongo', TTargetId>,
    assembledState?: AssembledComponentState,
  ): MongoControlFamilyInstance {
    if (!assembledState) {
      throw new Error(
        'MongoFamilyDescriptor.create() requires assembledState. ' +
          'Call assembleComponents() first and pass the result.',
      );
    }
    return createMongoFamilyInstance(assembledState);
  }
}
