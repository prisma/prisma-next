import type { JoinConfig } from 'better-auth/adapters';
import { unknownJoinRelation } from './errors';
import { relationsOf, resolveSpaceModel, type SpaceModelName } from './model-map';

export interface ResolvedJoin {
  readonly relationName: string;
  /** Row cap for to-many joins (BetterAuth defaults to 100); to-one joins carry none. */
  readonly limit: number | undefined;
}

const DEFAULT_TO_MANY_JOIN_LIMIT = 100;

/**
 * Resolves each entry of a BetterAuth `JoinConfig` to the contract relation
 * it must traverse. The joined model, the local column, and the target
 * column all have to line up with a navigable relation the better-auth
 * space declares — a join the contract cannot express fails fast with a
 * typed error instead of silently degrading.
 */
export function resolveJoinRelations(
  model: string,
  spaceModel: SpaceModelName,
  join: JoinConfig,
): readonly ResolvedJoin[] {
  return Object.entries(join).map(([joinModel, config]) => {
    const joinSpaceModel = resolveSpaceModel(joinModel);
    const relation = relationsOf(spaceModel).find(
      (candidate) =>
        candidate.toModel === joinSpaceModel &&
        candidate.localField === config.on.from &&
        candidate.targetField === config.on.to,
    );
    if (relation === undefined) {
      throw unknownJoinRelation(model, joinModel, config.on);
    }
    return {
      relationName: relation.relationName,
      limit:
        config.relation === 'one-to-one' ? undefined : (config.limit ?? DEFAULT_TO_MANY_JOIN_LIMIT),
    };
  });
}
