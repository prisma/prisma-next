export {
  type AggregateContractHasher,
  type DeclaredExtensionEntry,
  type LayoutViolation,
  type LoadAggregateError,
  type LoadAggregateInput,
  type LoadAggregateOutput,
  loadContractSpaceAggregate,
} from '../aggregate/loader';
export type { ContractMarkerRecordLike } from '../aggregate/marker-types';
export {
  type AggregateCurrentDBState,
  type AggregatePerSpacePlan,
  type AggregatePlannerError,
  type AggregatePlannerInput,
  type AggregatePlannerOutput,
  type AggregatePlannerSuccess,
  type CallerPolicy,
  planAggregate,
} from '../aggregate/planner';
export { projectSchemaToSpace } from '../aggregate/project-schema-to-space';
export {
  type GraphWalkOutcome,
  type GraphWalkStrategyInputs,
  graphWalkStrategy,
} from '../aggregate/strategies/graph-walk';
export type {
  ContractSpaceAggregate,
  ContractSpaceMember,
  HydratedMigrationGraph,
} from '../aggregate/types';
export {
  type AggregateVerifierError,
  type AggregateVerifierInput,
  type AggregateVerifierOutput,
  type AggregateVerifierSuccess,
  type MarkerCheckResult,
  type MarkerCheckSection,
  type OrphanElement,
  type SchemaCheckSection,
  verifyAggregate,
} from '../aggregate/verifier';
