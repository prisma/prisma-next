export {
  assertDescriptorSelfConsistency,
  type DescriptorSelfConsistencyInputs,
} from '../assert-descriptor-self-consistency';
export {
  type ComputeExtensionSpaceApplyPathInputs,
  computeExtensionSpaceApplyPath,
  type ExtensionSpaceApplyPathOutcome,
} from '../compute-extension-space-apply-path';
export type { SpaceApplyInput } from '../concatenate-space-apply-inputs';
export {
  type DetectSpaceContractDriftInputs,
  detectSpaceContractDrift,
  type SpaceContractDriftResult,
} from '../detect-space-contract-drift';
export {
  type ContractSpaceArtefactInputs,
  emitContractSpaceArtefacts,
} from '../emit-contract-space-artefacts';
export {
  type DiskContractSpaceState,
  gatherDiskContractSpaceState,
} from '../gather-disk-contract-space-state';
export {
  planAllSpaces,
  type SpacePlanInput,
  type SpacePlanOutput,
} from '../plan-all-spaces';
export { readContractSpaceContract } from '../read-contract-space-contract';
export {
  type ContractSpaceHeadRef,
  readContractSpaceHeadRef,
} from '../read-contract-space-head-ref';
export {
  APP_SPACE_ID,
  assertValidSpaceId,
  isValidSpaceId,
  spaceMigrationDirectory,
  type ValidSpaceId,
} from '../space-layout';
export {
  type ContractSpaceHeadRecord,
  listContractSpaceDirectories,
  type SpaceMarkerRecord,
  type SpaceVerifierViolation,
  type VerifyContractSpacesInputs,
  type VerifyContractSpacesResult,
  verifyContractSpaces,
} from '../verify-contract-spaces';
