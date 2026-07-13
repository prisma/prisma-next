import { PostgresContractSerializer } from '@prisma-next/target-postgres/runtime';
import { blindCast } from '@prisma-next/utils/casts';
import type { Contract } from '../contract/contract.d';
import contractJson from '../contract/contract.json' with { type: 'json' };
import { unknownField, unknownModel } from './errors';

// Type Parameter Pattern (AGENTS.md): the JSON import's static type is
// trusted nowhere — the shipped contract is structurally validated at
// module load and consumed through the emitted `Contract` type, so a
// corrupted contract.json fails fast here rather than as a mis-shaped
// query downstream.
const contract = new PostgresContractSerializer().deserializeContract<Contract>(contractJson);

/** Model names of the better-auth contract space (from the emitted contract types). */
export type SpaceModelName = keyof Contract['domain']['namespaces']['public']['models'] & string;

/**
 * BetterAuth default model name for every model of the better-auth contract
 * space.
 *
 * The `satisfies Record<SpaceModelName, string>` bound is the compile-time
 * exhaustiveness guard: a model added to the contract without a mapping here
 * fails `pnpm typecheck` (missing key), and a mapping for a model the
 * contract no longer defines fails as an excess property.
 */
export const BETTER_AUTH_MODEL_BY_SPACE_MODEL = {
  User: 'user',
  Session: 'session',
  Account: 'account',
  Verification: 'verification',
} as const satisfies Record<SpaceModelName, string>;

/** BetterAuth default model names handled by this adapter. */
export type BetterAuthModelName =
  (typeof BETTER_AUTH_MODEL_BY_SPACE_MODEL)[keyof typeof BETTER_AUTH_MODEL_BY_SPACE_MODEL];

function typedEntries<K extends string, V>(
  obj: Readonly<Record<K, V>>,
): ReadonlyArray<readonly [K, V]> {
  return blindCast<
    ReadonlyArray<readonly [K, V]>,
    'Object.entries widens literal keys to string; obj is a closed literal object so its entries are exactly [K, V] pairs'
  >(Object.entries(obj));
}

const spaceModelByBetterAuthModel: ReadonlyMap<string, SpaceModelName> = new Map(
  typedEntries(BETTER_AUTH_MODEL_BY_SPACE_MODEL).map(([spaceModel, betterAuthModel]) => [
    betterAuthModel,
    spaceModel,
  ]),
);

export const KNOWN_BETTER_AUTH_MODELS: readonly string[] = [...spaceModelByBetterAuthModel.keys()];

/**
 * Field-name sets per space model, read from the shipped `contract.json` so
 * runtime validation and the emitted contract cannot drift.
 */
const fieldsBySpaceModel: ReadonlyMap<string, ReadonlySet<string>> = new Map(
  Object.entries(contract.domain.namespaces.public.models).map(([modelName, modelDef]) => [
    modelName,
    new Set(Object.keys(modelDef.fields)),
  ]),
);

/** Resolves a BetterAuth model name to its space model, failing fast on unknown models. */
export function resolveSpaceModel(model: string): SpaceModelName {
  const spaceModel = spaceModelByBetterAuthModel.get(model);
  if (spaceModel === undefined) {
    throw unknownModel(model, KNOWN_BETTER_AUTH_MODELS);
  }
  return spaceModel;
}

/** Asserts that `field` exists on the resolved space model, failing fast otherwise. */
export function assertKnownField(model: string, spaceModel: SpaceModelName, field: string): void {
  const fields = fieldsBySpaceModel.get(spaceModel);
  if (fields === undefined || !fields.has(field)) {
    throw unknownField(model, field);
  }
}

/** Asserts every key of `data` is a known field of the resolved space model. */
export function assertKnownFields(
  model: string,
  spaceModel: SpaceModelName,
  data: Record<string, unknown>,
): void {
  for (const field of Object.keys(data)) {
    assertKnownField(model, spaceModel, field);
  }
}

/** A navigable relation of a space model, as declared by the shipped contract. */
export interface SpaceModelRelation {
  readonly relationName: string;
  readonly toModel: string;
  readonly localField: string;
  readonly targetField: string;
}

interface ContractDomainRelation {
  readonly to: { readonly model: string };
  readonly on: {
    readonly localFields: readonly string[];
    readonly targetFields: readonly string[];
  };
}

function singleField(
  fields: readonly string[],
  modelName: string,
  relationName: string,
  side: 'local' | 'target',
): string {
  const [field, ...rest] = fields;
  if (field === undefined || rest.length > 0) {
    throw new Error(
      `better-auth space relation "${modelName}.${relationName}" declares ${fields.length} ${side} fields; the adapter's join mapping requires exactly one. The shipped contract should never produce this — it indicates a corrupted or hand-edited contract.json.`,
    );
  }
  return field;
}

const relationsBySpaceModel: ReadonlyMap<string, readonly SpaceModelRelation[]> = new Map(
  Object.entries(contract.domain.namespaces.public.models).map(([modelName, modelDef]) => {
    const relations: Readonly<Record<string, ContractDomainRelation>> =
      'relations' in modelDef ? modelDef.relations : {};
    return [
      modelName,
      Object.entries(relations).map(([relationName, relation]) => ({
        relationName,
        toModel: relation.to.model,
        localField: singleField(relation.on.localFields, modelName, relationName, 'local'),
        targetField: singleField(relation.on.targetFields, modelName, relationName, 'target'),
      })),
    ];
  }),
);

/** Navigable relations declared by the shipped contract for a space model. */
export function relationsOf(spaceModel: SpaceModelName): readonly SpaceModelRelation[] {
  return relationsBySpaceModel.get(spaceModel) ?? [];
}
