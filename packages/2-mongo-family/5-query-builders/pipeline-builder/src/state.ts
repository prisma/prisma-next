import type { MongoReadStage } from '@prisma-next/mongo-query-ast';

export interface PipelineBuilderState {
  readonly collection: string;
  readonly stages: ReadonlyArray<MongoReadStage>;
  readonly storageHash: string;
}

export function cloneState(
  state: PipelineBuilderState,
  overrides: Partial<PipelineBuilderState>,
): PipelineBuilderState {
  return { ...state, ...overrides };
}
