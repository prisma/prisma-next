import type { JoinConfig } from 'better-auth/adapters';
import { unknownJoinRelation } from './errors';
import { relationsOf, resolveSpaceModel, type SpaceModelName } from './model-map';

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
): readonly string[] {
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
    return relation.relationName;
  });
}
