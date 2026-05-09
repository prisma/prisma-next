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
  emitPinnedSpaceArtefacts,
  type PinnedSpaceArtefactInputs,
  type PinnedSpaceHeadRef,
} from '../emit-pinned-space-artefacts';
export {
  type DiskContractSpaceState,
  gatherDiskContractSpaceState,
} from '../gather-disk-contract-space-state';
export {
  planAllSpaces,
  type SpacePlanInput,
  type SpacePlanOutput,
} from '../plan-all-spaces';
export { readPinnedContractHash } from '../read-pinned-contract-hash';
export { type PinnedHeadRef, readPinnedHeadRef } from '../read-pinned-head-ref';
export { readPinnedSpaceContract } from '../read-pinned-space-contract';
export {
  APP_SPACE_ID,
  assertValidSpaceId,
  isValidSpaceId,
  spaceMigrationDirectory,
  type ValidSpaceId,
} from '../space-layout';
export {
  listPinnedSpaceDirectories,
  type SpaceMarkerRecord,
  type SpacePinnedHashRecord,
  type SpaceVerifierViolation,
  type VerifyContractSpacesInputs,
  type VerifyContractSpacesResult,
  verifyContractSpaces,
} from '../verify-contract-spaces';
