import type { MongoPipelineStage } from '@prisma-next/mongo-query-ast/execution';

const identityStageKinds = new Set(['match', 'sort', 'limit', 'skip', 'sample']);

export function pipelineSupportsFlatResultShape(
  stages: ReadonlyArray<MongoPipelineStage>,
): boolean {
  for (const stage of stages) {
    const k = stage.kind;
    if (!identityStageKinds.has(k)) {
      return false;
    }
  }
  return true;
}
