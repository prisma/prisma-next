export type {
  // Descriptors
  AdapterDescriptor,
  // Instances
  AdapterInstance,
  AdapterPackRef,
  ComponentDescriptor,
  ComponentMetadata,
  ContractComponentRequirementsCheckInput,
  ContractComponentRequirementsCheckResult,
  DriverDescriptor,
  DriverInstance,
  DriverPackRef,
  ExtensionDescriptor,
  ExtensionInstance,
  ExtensionPackRef,
  FamilyDescriptor,
  FamilyInstance,
  // Type renderers for parameterized codec emission
  NormalizedTypeRenderer,
  PackRefBase,
  RenderTypeContext,
  TargetBoundComponentDescriptor,
  TargetDescriptor,
  TargetInstance,
  TargetPackRef,
  TypeRenderer,
  TypeRendererFunction,
  TypeRendererTemplate,
} from '../framework-components';

export {
  checkContractComponentRequirements,
  interpolateTypeTemplate,
  normalizeRenderer,
} from '../framework-components';
