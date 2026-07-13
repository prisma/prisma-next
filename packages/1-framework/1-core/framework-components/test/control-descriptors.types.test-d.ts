import type { Contract, StorageBase } from '@prisma-next/contract/types';
import { expectTypeOf, test } from 'vitest';
import type { ControlExtensionDescriptor } from '../src/control/control-descriptors';
import type { ContractSpace } from '../src/control/control-spaces';

// Mirrors how the sql/mongo families narrow contractSpace to their storage shape.
interface DemoStorage extends StorageBase {
  readonly demoOnly: true;
}

interface NarrowedExtensionDescriptor extends ControlExtensionDescriptor<'sql', 'postgres'> {
  readonly contractSpace?: ContractSpace<Contract<DemoStorage>>;
}

test('core extension descriptor declares an optional framework-level contract space', () => {
  expectTypeOf<ControlExtensionDescriptor<'sql', 'postgres'>['contractSpace']>().toEqualTypeOf<
    ContractSpace | undefined
  >();
});

test('family descriptors narrow contractSpace and stay assignable to the core descriptor', () => {
  expectTypeOf<NarrowedExtensionDescriptor>().toExtend<
    ControlExtensionDescriptor<'sql', 'postgres'>
  >();
  expectTypeOf<NarrowedExtensionDescriptor['contractSpace']>().toEqualTypeOf<
    ContractSpace<Contract<DemoStorage>> | undefined
  >();
});

test('typed contract access needs no casts', () => {
  const readComposedContract = (
    descriptor: ControlExtensionDescriptor<string, string>,
  ): Contract | undefined => descriptor.contractSpace?.contractJson;

  expectTypeOf(readComposedContract).returns.toEqualTypeOf<Contract | undefined>();
});
