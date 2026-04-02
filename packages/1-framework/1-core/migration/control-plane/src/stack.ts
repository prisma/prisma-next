import type {
  ControlAdapterDescriptor,
  ControlDriverDescriptor,
  ControlExtensionDescriptor,
  ControlPlaneStack,
  ControlTargetDescriptor,
} from './types';

export function createControlPlaneStack<TFamilyId extends string, TTargetId extends string>(input: {
  readonly target: ControlTargetDescriptor<TFamilyId, TTargetId>;
  readonly adapter: ControlAdapterDescriptor<TFamilyId, TTargetId>;
  readonly driver?: ControlDriverDescriptor<TFamilyId, TTargetId> | undefined;
  readonly extensionPacks?: readonly ControlExtensionDescriptor<TFamilyId, TTargetId>[] | undefined;
}): ControlPlaneStack<TFamilyId, TTargetId> {
  return {
    target: input.target,
    adapter: input.adapter,
    driver: input.driver,
    extensionPacks: input.extensionPacks ?? [],
  };
}
