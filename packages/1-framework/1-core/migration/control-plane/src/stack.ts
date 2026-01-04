import type {
  ControlAdapterDescriptor,
  ControlExtensionDescriptor,
  ControlPlaneStack,
  ControlPlaneStackInput,
} from './types';

export function createControlPlaneStack<
  TFamilyId extends string,
  TTargetId extends string,
  TAdapterDescriptor extends ControlAdapterDescriptor<
    TFamilyId,
    TTargetId
  > = ControlAdapterDescriptor<TFamilyId, TTargetId>,
  TExtensionPacks extends readonly ControlExtensionDescriptor<
    TFamilyId,
    TTargetId
  >[] = readonly ControlExtensionDescriptor<TFamilyId, TTargetId>[],
>(
  input: ControlPlaneStackInput<TFamilyId, TTargetId, TAdapterDescriptor, TExtensionPacks>,
): ControlPlaneStack<TFamilyId, TTargetId, TAdapterDescriptor, TExtensionPacks> {
  return {
    target: input.target,
    adapter: input.adapter,
    driver: input.driver,
    extensionPacks: (input.extensionPacks ?? []) as TExtensionPacks,
  };
}
