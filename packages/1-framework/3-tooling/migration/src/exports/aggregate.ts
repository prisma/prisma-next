export {
  collectAggregateNamespaces,
  createContractSpaceAggregate,
  createContractSpaceMember,
  requireHeadRef,
} from '../aggregate/aggregate';
export {
  computeIntegrityViolations,
  type IntegrityComputationInput,
  type IntegritySpaceState,
  loadProblemToViolation,
} from '../aggregate/check-integrity';
export { type LoadAggregateInput, loadContractSpaceAggregate } from '../aggregate/loader';
export type { ContractMarkerRecordLike } from '../aggregate/marker-types';
export {
  type AggregateCurrentDBState,
  type AggregateMigrationEdgeRef,
  type CallerPolicy,
  type PerSpacePlan,
  type PlannerError,
  type PlannerInput,
  type PlannerOutput,
  type PlannerSuccess,
  planMigration,
} from '../aggregate/planner';
export {
  otherMemberEntityNames,
  scopeSchemaResultToSpace,
} from '../aggregate/scope-schema-result';
export {
  type GraphWalkOutcome,
  type GraphWalkStrategyInputs,
  graphWalkStrategy,
} from '../aggregate/strategies/graph-walk';
export { buildSynthMigrationEdge } from '../aggregate/synth-migration-edge';
export type {
  ContractAtOptions,
  ContractAtResult,
  ContractSpaceAggregate,
  ContractSpaceMember,
} from '../aggregate/types';
export {
  type MarkerCheckResult,
  type MarkerCheckSection,
  type SchemaCheckSection,
  type VerifierError,
  type VerifierInput,
  type VerifierOutput,
  type VerifierSuccess,
  verifyMigration,
} from '../aggregate/verifier';
export type {
  DeclaredExtensionEntry,
  IntegrityQueryOptions,
  IntegrityViolation,
} from '../integrity-violation';
